/**
 * 智慧物聯網健康輔助系統 - ESP32 主控板韌體
 * 
 * 功能：
 * 1. 連接 Wi-Fi 並作為 WebSocket 用戶端連線至電腦端的 server.py。
 * 2. 讀取 HX711 智慧杯墊重量 (5kg 壓力感測器)。
 * 3. 讀取 HC-SR04 超音波距離感測器。
 * 4. 經由 HardwareSerial 2 (Serial2, RX2=GPIO16) 接收來自 Arduino Nano 的 PM2.5 數據。
 * 5. 依據異常健康狀況的數量，利用 PWM 動態控制無源蜂鳴器的音高與鳴叫頻率。
 * 6. 本地端與伺服器雙向同步：發送感測值至電腦，並接收電腦端久坐/缺水判定以連動蜂鳴器。
 * 
 * 依賴庫（請在 Arduino IDE 庫管理器中安裝）：
 * - HX711 (by Bogdan Necula)
 * - ArduinoJson (by Benoit Blanchon, 建議 v6 或 v7)
 * - WebSockets (by Markus Sattler / Links2004)
 */

#include <WiFi.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <HX711.h>

// ================= 1. 使用者環境設定 =================
const char* ssid     = "您的WiFi名稱";
const char* password = "您的WiFi密碼";
const char* ws_host  = "192.168.1.100";  // 執行 server.py 的電腦 IP 位址
const int   ws_port  = 3000;

// ================= 2. 硬體腳位定義 =================
// HC-SR04 超音波距離
const int TRIG_PIN = 22;
const int ECHO_PIN = 23;

// HX711 秤重模組
const int HX711_DOUT = 19;
const int HX711_SCK  = 18;
HX711 scale;
float scale_calibration_factor = 420.0; // 秤重校準參數 (需根據實測調整)

// 無源蜂鳴器 (PWM 控制)
const int BUZZER_PIN = 21;
// ESP32 PWM 頻道設定 (相容舊版 ESP32 核心與 LEDC)
const int pwmChannel = 0;
const int pwmResolution = 8;

// UART 2 (接 Arduino Nano TX)
// ESP32 預設的 RX2 為 GPIO16。接線：Nano TX -> 分壓電阻 -> ESP32 RX2 (GPIO16)
#define RXD2 16
#define TXD2 17  // 未使用

// ================= 3. 系統狀態變數 =================
float current_weight = 0.0;
float current_distance = 0.0;
float current_pm25 = 0.0;

// 各項健康警告階段 (0 = 正常, 1 = 輕微, 2 = 嚴重)
int stage_posture = 0;
int stage_air = 0;
int stage_sedentary = 0;
int stage_dehydration = 0;

int active_warning_count = 0;
unsigned long last_sensor_send = 0;
const unsigned long send_interval = 1000; // 每秒發送一次封包

WebSocketsClient webSocket;

// ================= 4. 蜂鳴器控制邏輯 =================
unsigned long last_beep_time = 0;
bool buzzer_state = false;

// 根據警告數量更新蜂鳴器 PWM 頻率與節奏
void handleBuzzerSound() {
  // 如果警告數為 0，關閉聲音
  if (active_warning_count == 0) {
    ledcWrite(pwmChannel, 0); // 輸出佔空比 0 (靜音)
    return;
  }

  // 根據警告數決定音調頻率 (Hz) 與發聲間隔 (ms)
  int frequency = 440;
  int interval = 2000;
  
  if (active_warning_count == 1) {
    frequency = 440;   // A4
    interval = 2000;
  } else if (active_warning_count == 2) {
    frequency = 660;   // E5
    interval = 1000;
  } else if (active_warning_count == 3) {
    frequency = 880;   // A5
    interval = 500;
  } else if (active_warning_count >= 4) {
    frequency = 1200;  // D6
    interval = 250;
  }

  unsigned long current_time = millis();
  if (current_time - last_beep_time >= interval) {
    last_beep_time = current_time;
    
    // 每次鳴叫 100 毫秒 (無源蜂鳴器發出對應頻率的方波)
    ledcWriteTone(pwmChannel, frequency);
    ledcWrite(pwmChannel, 128); // 50% 佔空比
    delay(100);
    ledcWrite(pwmChannel, 0);   // 靜音
  }
}

// ================= 5. 傳感器數據讀取 =================
void readDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  
  long duration = pulseIn(ECHO_PIN, HIGH, 30000); // 設置 30ms 逾時
  if (duration == 0) {
    current_distance = 100.0; // 超出範圍預設 100cm
  } else {
    current_distance = duration * 0.034 / 2.0;
  }
}

void readWeight() {
  if (scale.is_ready()) {
    // 取得扣除皮重後的重量值 (克)
    current_weight = scale.get_units(3); // 讀取 3 次取平均
    if (current_weight < 0) current_weight = 0;
  }
}

void readNanoSerial() {
  if (Serial2.available()) {
    String line = Serial2.readStringUntil('\n');
    line.trim();
    
    // 解析 Nano 發送的資料，例如 "PM25:15.5"
    if (line.startsWith("PM25:")) {
      String valStr = line.substring(5);
      current_pm25 = valStr.toFloat();
    }
  }
}

// 本地安全判定 (當 WebSocket 斷線或未同步時提供基本安全防護)
void updateLocalWarningStages() {
  // 1. 姿勢距離判定
  if (current_distance < 25) stage_posture = 2;
  else if (current_distance < 35) stage_posture = 1;
  else stage_posture = 0;

  // 2. 空氣品質判定
  if (current_pm25 >= 75) stage_air = 2;
  else if (current_pm25 >= 35) stage_air = 1;
  else stage_air = 0;

  // 註：久坐及水分判定需要網頁/PC端累積時間，本地預設不累加，除非收到伺服器指令
}

void calculateWarningCount() {
  int count = 0;
  if (stage_posture > 0) count++;
  if (stage_air > 0) count++;
  if (stage_sedentary > 0) count++;
  if (stage_dehydration > 0) count++;
  active_warning_count = count;
}

// ================= 6. WebSocket 資料通訊 =================
void sendSensorPacket() {
  // 封裝成 JSON 封包傳送
  StaticJsonDocument<300> doc;
  doc["device_id"] = "virtual_esp32_01"; // 與模擬器共用同一個ID以直接驅動桌面寵物
  doc["timestamp"] = millis() / 1000;
  
  JsonObject sensors = doc.createNestedObject("sensors");
  sensors["weight"] = (int)current_weight;
  sensors["distance"] = (int)current_distance;
  sensors["pm25"] = (int)current_pm25;

  JsonObject status = doc.createNestedObject("status");
  status["is_drinking"] = false; // 飲水事件由重量減少判定，網頁端會處理
  status["posture"] = (stage_posture == 2) ? "too_close" : ((stage_posture == 1) ? "slouched" : "good");
  status["air_quality"] = (stage_air == 2) ? "danger" : ((stage_air == 1) ? "poor" : "excellent");
  
  String output;
  serializeJson(doc, output);
  webSocket.sendTXT(output);
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] 連線已中斷");
      break;
    case WStype_CONNECTED:
      Serial.println("[WS] 已連線至伺服器");
      break;
    case WStype_TEXT:
      {
        // 接收來自 WebSocket 伺服器廣播的狀態 (同步久坐與水分 Stage)
        StaticJsonDocument<500> doc;
        DeserializationError error = deserializeJson(doc, payload);
        if (error) return;

        // 如果封包內包含狀態欄位 (來自 PC 網頁端廣播的更新狀態)
        if (doc.containsKey("status")) {
          JsonObject status = doc["status"];
          if (status.containsKey("posture_stage")) stage_posture = status["posture_stage"];
          if (status.containsKey("air_stage")) stage_air = status["air_stage"];
          if (status.containsKey("sedentary_stage")) stage_sedentary = status["sedentary_stage"];
          if (status.containsKey("dehydration_stage")) stage_dehydration = status["dehydration_stage"];
          
          calculateWarningCount();
        }
      }
      break;
  }
}

// ================= 7. 初始化與主循環 =================
void setup() {
  Serial.begin(115200);
  
  // 初始化 HardwareSerial 2 用於讀取 Nano (波特率 9600)
  Serial2.begin(9600, SERIAL_8N1, RXD2, TXD2);

  // 初始化超音波腳位
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  // 初始化無源蜂鳴器 (使用 ESP32 LEDC PWM)
  ledcSetup(pwmChannel, 2000, pwmResolution);
  ledcAttachPin(BUZZER_PIN, pwmChannel);
  ledcWrite(pwmChannel, 0); // 預設靜音

  // 初始化 HX711 秤重模組
  scale.begin(HX711_DOUT, HX711_SCK);
  // scale.set_scale(scale_calibration_factor); // 設定校準係數
  // scale.tare(); // 啟動歸零

  // 連線 Wi-Fi
  Serial.print("正在連線至 Wi-Fi: ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi 連線成功！");
  Serial.print("本地 IP: ");
  Serial.println(WiFi.localIP());

  // 初始化 WebSocket 連線
  webSocket.begin(ws_host, ws_port, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000); // 斷線後每 5 秒重試
}

void loop() {
  webSocket.loop();

  // 1. 讀取感測器數值
  readDistance();
  readWeight();
  readNanoSerial();

  // 2. 本地預警判定 (當沒接到 WebSocket 時作為備援)
  if (!webSocket.isConnected()) {
    updateLocalWarningStages();
    stage_sedentary = 0;   // 離線下久坐無法由電腦計算，設為 0
    stage_dehydration = 0; // 離線下水分無法由電腦計算，設為 0
    calculateWarningCount();
  }

  // 3. 每隔一秒向 WebSocket 伺服器傳送最新感測器數據
  unsigned long current_time = millis();
  if (current_time - last_sensor_send >= send_interval) {
    last_sensor_send = current_time;
    if (webSocket.isConnected()) {
      sendSensorPacket();
    }
  }

  // 4. 動態控制無源蜂鳴器警報發聲
  handleBuzzerSound();

  delay(20); // 稍微小休眠穩定迴圈
}
