/**
 * 智慧物聯網健康輔助系統 - ESP32 主控板韌體 (直連感測器版)
 * 
 * 功能：
 * 1. 連接 Wi-Fi 並作為 WebSocket 用戶端連線至電腦端的 server.py。
 * 2. 讀取 HX711 智慧杯墊重量 (5kg 壓力感測器)。
 * 3. 讀取 HC-SR04 超音波距離感測器。
 * 4. 直接驅動並讀取 GP2Y1010AU0F 光學粉塵感測器 (無需 Arduino Nano)。
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
float scale_calibration_factor = 420.0; // 秤重校準參數

// GP2Y1010AU0F 粉塵感測器直連
const int DUST_LED_PIN = 27;     // 接粉塵感測器 Pin 3 (LED 控制腳)
const int DUST_ANALOG_PIN = 34;  // 接粉塵感測器 Pin 5 (Vo 輸出腳，經分壓電阻接至 GPIO34/ADC1_CH6)

// 無源蜂鳴器 (PWM 控制)
const int BUZZER_PIN = 21;
const int pwmChannel = 0;
const int pwmResolution = 8;

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

void handleBuzzerSound() {
  if (active_warning_count == 0) {
    ledcWrite(pwmChannel, 0); // 靜音
    return;
  }

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
    
    // 每次鳴叫 100 毫秒
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
  
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) {
    current_distance = 100.0;
  } else {
    current_distance = duration * 0.034 / 2.0;
  }
}

void readWeight() {
  if (scale.is_ready()) {
    current_weight = scale.get_units(3);
    if (current_weight < 0) current_weight = 0;
  }
}

// GP2Y1010AU0F 直連精確採樣
unsigned long last_pm25_read = 0;
const unsigned long pm25_read_interval = 1000; // 每秒讀取一次

void readPM25Direct() {
  if (millis() - last_pm25_read >= pm25_read_interval) {
    last_pm25_read = millis();
    
    // 1. 開啟紅外線 LED (低電平觸發開關)
    digitalWrite(DUST_LED_PIN, LOW); 
    delayMicroseconds(280); // 等待 280µs 穩定
    
    // 2. 進行 ADC 類比讀取 (GPIO34)
    float raw = analogRead(DUST_ANALOG_PIN); 
    
    delayMicroseconds(40);
    // 3. 關閉紅外線 LED
    digitalWrite(DUST_LED_PIN, HIGH); 
    
    // 4. 計算輸入電壓 (12-bit ADC: 0-4095, 參考電壓 3.3V)
    float measured_voltage = raw * (3.3 / 4095.0);
    
    // 5. 補償分壓電阻比例
    // 我們在電路中建議使用 10kΩ 與 15kΩ 串聯分壓，分壓比例為 15/(10+15) = 0.6
    // 因此真實輸出電壓為 measured_voltage / 0.6
    float sensor_voltage = measured_voltage / 0.6;
    
    // 6. 依據 Sharp 官方關係式計算 PM2.5 濃度 (ug/m3)
    float dustDensity = 170.0 * sensor_voltage - 100.0;
    if (dustDensity < 0) {
      dustDensity = 0.0;
    }
    
    // 一階低通濾波 (平滑數據，權重 80% 舊值, 20% 新值)
    current_pm25 = (current_pm25 * 0.8) + (dustDensity * 0.2);
  }
}

// 本地安全判定 (離線時的警報防護)
void updateLocalWarningStages() {
  if (current_distance < 25) stage_posture = 2;
  else if (current_distance < 35) stage_posture = 1;
  else stage_posture = 0;

  if (current_pm25 >= 75) stage_air = 2;
  else if (current_pm25 >= 35) stage_air = 1;
  else stage_air = 0;
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
  StaticJsonDocument<300> doc;
  doc["device_id"] = "virtual_esp32_01";
  doc["timestamp"] = millis() / 1000;
  
  JsonObject sensors = doc.createNestedObject("sensors");
  sensors["weight"] = (int)current_weight;
  sensors["distance"] = (int)current_distance;
  sensors["pm25"] = (int)current_pm25;

  JsonObject status = doc.createNestedObject("status");
  status["is_drinking"] = false;
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
        StaticJsonDocument<500> doc;
        DeserializationError error = deserializeJson(doc, payload);
        if (error) return;

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

  // 初始化超音波腳位
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  // 初始化 GP2Y1010AU0F 直連腳位
  pinMode(DUST_LED_PIN, OUTPUT);
  digitalWrite(DUST_LED_PIN, HIGH); // 預設關閉 LED (High)
  pinMode(DUST_ANALOG_PIN, INPUT);

  // 初始化無源蜂鳴器 (LEDC PWM)
  ledcSetup(pwmChannel, 2000, pwmResolution);
  ledcAttachPin(BUZZER_PIN, pwmChannel);
  ledcWrite(pwmChannel, 0); // 預設靜音

  // 初始化 HX711 秤重模組
  scale.begin(HX711_DOUT, HX711_SCK);

  // 連線 Wi-Fi
  Serial.print("正在連線至 Wi-Fi: ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi 連線成功！");

  // 初始化 WebSocket
  webSocket.begin(ws_host, ws_port, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

void loop() {
  webSocket.loop();

  // 1. 讀取感測器數值
  readDistance();
  readWeight();
  readPM25Direct(); // ESP32 直接採樣

  // 2. 本地預警判定 (當沒接到 WebSocket 時作為備援)
  if (!webSocket.isConnected()) {
    updateLocalWarningStages();
    stage_sedentary = 0;
    stage_dehydration = 0;
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

  delay(20);
}
