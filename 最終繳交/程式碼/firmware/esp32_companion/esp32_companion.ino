/**
 * 智慧物聯網健康輔助系統 - ESP32 主控板韌體 (USB 序列埠直連版)
 * 
 * 功能：
 * 1. 透過 USB 傳輸線與電腦進行 115200 速率的 Serial 序列埠通訊。
 * 2. 讀取 HX711 智慧杯墊重量 (5kg 壓力感測器)，支援使用者主動歸零校正（Tare）。
 * 3. 讀取 HC-SR04 超音波距離感測器，偵測坐姿距離。
 * 4. 直接驅動並讀取 GP2Y1010AU0F 光學粉塵感測器。
 * 5. 依據異常健康狀況數量，利用 PWM 控制無源蜂鳴器警報。
 * 6. 透過 Serial 接收來自電腦的健康危害階段指令以連動蜂鳴器。
 * 
 * 依賴庫（請在 Arduino IDE 庫管理器中安裝）：
 * - HX711 (by Bogdan Necula)
 * - ArduinoJson (by Benoit Blanchon, 建議 v6 或 v7)
 */

#include <ArduinoJson.h>
#include <HX711.h>

// ================= 1. 硬體腳位定義 =================
// HC-SR04 超音波距離
const int TRIG_PIN = 22;
const int ECHO_PIN = 23;

// HX711 秤重模組
const int HX711_DOUT = 19;
const int HX711_SCK  = 18;
HX711 scale;

// GP2Y1010AU0F 粉塵感測器直連
const int DUST_LED_PIN    = 27;   // Pin 3 (LED 控制腳)
const int DUST_ANALOG_PIN = 34;   // Pin 5 (Vo 輸出腳，需分壓電阻)

// 無源蜂鳴器 (PWM 控制)
// 注意：ESP32 Arduino Core v3.x 新版 API，直接使用腳位號，不再需要通道號
const int BUZZER_PIN = 21;
const int BUZZER_RES = 8; // 8-bit 解析度 (0-255)

// ================= 2. 坐姿距離警告門檻 =================
// 說明：超音波感測器安裝於螢幕正前方，偵測使用者的頭/胸部距離。
// 可以根據你的安裝位置往下調整這兩個數值。
const float POSTURE_MILD_CM   = 50.0; // 超過此距離 -> 輕微太近警告
const float POSTURE_SEVERE_CM = 35.0; // 超過此距離 -> 嚴重太近警告

// ================= 3. 水杯校正與飲水偵測參數 =================
// 飲水偵測邏輯（方案 B：單階滿杯校正 + 狀態機判定）：
//   使用者放上裝滿水的水杯後點擊歸零校正，ESP32 收到 {"cmd":"tare"}，
//   此時以當前重量做為基準 0g。當水杯被拿起，重量會急速下降，判定為正在喝水，
//   並記錄最低的負值（絕對值即為本杯水原重量）。放下後，依據放下穩定後的重量
//   與拿起前的差值，計算喝水量並累加。

const int   TARE_SAMPLE_COUNT   = 20;    // 歸零時，取樣 20 次平均以確保穩定
const float LIFT_THRESHOLD_G    = 80.0;  // 拿起水杯的門檻值 (g)

bool  is_calibrated         = false; // 使用者是否已主動完成歸零校正
float original_full_weight  = 0.0;   // 本杯水原重量 (g)
float today_water_intake    = 0.0;   // 今日喝水量 (ml)
float last_stable_weight    = 0.0;   // 上一次穩定的重量基準 (g)
float current_weight        = 0.0;   // 目前量測到的重量 (g，相對於 Tare 時的 0g，為負值或0)
bool  is_drinking           = false; // 使用者是否正在喝水（拿起狀態）
bool  lift_confirmed        = false; // 是否已確認拿起（秤空穩定）
float min_weight_during_lift= 0.0;   // 拿起杯子期間讀取到的最低重量（最接近淨空狀態的負值）
float prev_read_weight      = 99999.0; // 上一次讀取到的重量值
int   stable_count          = 0;     // 連續穩定讀取的次數計數器

// ================= 4. 系統狀態變數 =================
float current_distance = 0.0;
float current_pm25     = 0.0;

// 各項健康警告階段 (0 = 正常, 1 = 輕微, 2 = 嚴重)
int stage_posture     = 0;
int stage_air         = 0;
int stage_sedentary   = 0;
int stage_dehydration = 0;

int           active_warning_count = 0;
unsigned long last_sensor_send     = 0;
const unsigned long SEND_INTERVAL  = 1000; // 每秒發送一次封包

// ================= 5. 蜂鳴器控制 =================
unsigned long last_beep_time = 0;

// 依警告等級設定音頻與間隔
struct BuzzerConfig {
  int freq;
  int interval_ms;
};

const BuzzerConfig BUZZER_CONFIGS[] = {
  {   0,    0 }, // 0 個警告 -> 靜音
  { 440, 2000 }, // 1 個警告 -> A4，每 2 秒嗶一聲
  { 660, 1000 }, // 2 個警告 -> E5，每 1 秒嗶一聲
  { 880,  500 }, // 3 個警告 -> A5，每 0.5 秒嗶一聲
  {1200,  250 }, // 4 個警告 -> D6，每 0.25 秒嗶一聲
};

void buzzerBeep(int freq, int duration_ms) {
  ledcWriteTone(BUZZER_PIN, freq);
  delay(duration_ms);
  ledcWriteTone(BUZZER_PIN, 0);
}

void handleBuzzerSound() {
  if (active_warning_count == 0) {
    ledcWriteTone(BUZZER_PIN, 0);
    return;
  }

  int idx = min(active_warning_count, 4);
  int freq     = BUZZER_CONFIGS[idx].freq;
  int interval = BUZZER_CONFIGS[idx].interval_ms;

  unsigned long now = millis();
  if (now - last_beep_time >= (unsigned long)interval) {
    last_beep_time = now;
    // 嗶聲持續 120ms
    ledcWriteTone(BUZZER_PIN, freq);
    ledcWrite(BUZZER_PIN, 200); // 約 78% 佔空比
    delay(120);
    ledcWrite(BUZZER_PIN, 0);
    ledcWriteTone(BUZZER_PIN, 0);
  }
}

// ================= 6. 傳感器數據讀取 =================

// 6-1 超音波距離
void readDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000); // 逾時 30ms
  current_distance = (duration == 0) ? 200.0 : (duration * 0.034 / 2.0);
}

// 6-2 秤重（含飲水偵測，狀態機與穩定濾波版）
// 回傳值：true = 本次偵測到「飲水動作」，false = 無飲水或尚未校正
bool readWeightAndDetectDrink() {
  if (!scale.is_ready()) return false;

  // 讀取當前重量（相對於 Tare 時的滿水杯，通常是 0 或負數）
  float raw_g = scale.get_units(3); // 降低取樣次數以加快讀取速度，並減少延遲
  current_weight = raw_g;

  if (!is_calibrated) return false;

  bool did_drink = false;

  // 1. 計算穩定度：當前讀值與前一次讀值的差，若小於 5.0g 則視為穩定
  float diff = abs(current_weight - prev_read_weight);
  bool is_stable = (prev_read_weight != 99999.0) && (diff < 5.0);
  prev_read_weight = current_weight;

  if (is_stable) {
    stable_count++;
  } else {
    stable_count = 0;
  }

  // 2. 狀態機判定：
  if (!is_drinking) {
    // A. 尚未拿起：重量小於穩定基準減去 LIFT_THRESHOLD_G (80g) ➔ 觸發拿起
    if (current_weight < last_stable_weight - LIFT_THRESHOLD_G) {
      is_drinking = true;
      lift_confirmed = false;
      stable_count = 0;
      min_weight_during_lift = current_weight;
      Serial.println("[狀態機] 偵測到拿起水杯，等待秤空穩定...");
    } else {
      // 若正常放置於杯墊上，且讀值穩定，且重量有增加大於 30g（例如加水），更新基準重量
      if (is_stable && stable_count >= 3 && current_weight > last_stable_weight + 30.0) {
        last_stable_weight = current_weight;
        Serial.print("[狀態機] 偵測到加水/調整，更新穩定重量為：");
        Serial.println((int)last_stable_weight);
      }
    }
  } else {
    // B. 已進入拿起狀態
    
    // a. 等待完全拿開（空載穩定）
    if (!lift_confirmed) {
      if (current_weight < min_weight_during_lift) {
        min_weight_during_lift = current_weight;
      }
      // 連續 3 次穩定，且讀值小於 last_stable_weight - 80g
      if (is_stable && stable_count >= 3 && current_weight < last_stable_weight - LIFT_THRESHOLD_G) {
        lift_confirmed = true;
        min_weight_during_lift = current_weight;
        original_full_weight = abs(min_weight_during_lift);
        stable_count = 0; // 重設計數給放下使用
        Serial.print("[狀態機] ✅ 拿起確認！秤空穩定重量：");
        Serial.print((int)min_weight_during_lift);
        Serial.print(" g，本杯水原重量：");
        Serial.print((int)original_full_weight);
        Serial.println(" g");
      }
    }
    // b. 已確認完全拿起，等待放回
    else {
      // 放回條件：重量顯著回升（大於最低重量 + 80g），且連續穩定
      if (current_weight > min_weight_during_lift + 80.0) {
        if (is_stable && stable_count >= 3) {
          float delta = last_stable_weight - current_weight;
          
          if (delta >= 15.0) { // 喝水超過 15g 判定為喝水
            today_water_intake += delta;
            did_drink = true;
            Serial.print("[狀態機] ✅ 放下水杯！本次喝水：");
            Serial.print((int)delta);
            Serial.print(" g，今日累計：");
            Serial.print((int)today_water_intake);
            Serial.println(" ml");
          } else {
            Serial.println("[狀態機] 放下水杯！未檢測到有效飲水（或僅是隨手拿放）。");
          }
          
          // 回歸正常狀態
          last_stable_weight = current_weight;
          is_drinking = false;
          lift_confirmed = false;
          stable_count = 0;
        }
      } else {
        // 如果重量又掉回去（如手抖或尚未放好），重設計數
        stable_count = 0;
      }
    }
  }

  return did_drink;
}

// 6-3 PM2.5 粉塵感測器
unsigned long last_pm25_read     = 0;
const unsigned long PM25_INTERVAL = 1000;

void readPM25Direct() {
  if (millis() - last_pm25_read < PM25_INTERVAL) return;
  last_pm25_read = millis();

  digitalWrite(DUST_LED_PIN, LOW);
  delayMicroseconds(280);
  float raw = analogRead(DUST_ANALOG_PIN);
  delayMicroseconds(40);
  digitalWrite(DUST_LED_PIN, HIGH);

  float voltage      = raw * (3.3 / 4095.0);
  float real_voltage = voltage / 0.6;          // 補償分壓比 (10k / (10k+15k))
  float dust         = 170.0 * real_voltage - 100.0;
  if (dust < 0) dust = 0;

  current_pm25 = current_pm25 * 0.8 + dust * 0.2; // 低通濾波
}

// 本地警告判定（離線備援）
void updateLocalWarningStages() {
  // 坐姿
  if      (current_distance < POSTURE_SEVERE_CM) stage_posture = 2;
  else if (current_distance < POSTURE_MILD_CM)   stage_posture = 1;
  else                                            stage_posture = 0;

  // 空氣品質
  if      (current_pm25 >= 75) stage_air = 2;
  else if (current_pm25 >= 35) stage_air = 1;
  else                         stage_air = 0;
}

void calculateWarningCount() {
  active_warning_count =
    (stage_posture     > 0 ? 1 : 0) +
    (stage_air         > 0 ? 1 : 0) +
    (stage_sedentary   > 0 ? 1 : 0) +
    (stage_dehydration > 0 ? 1 : 0);
}

// ================= 7. Serial 資料通訊 =================

void sendSensorPacket(bool is_drinking_state) {
  StaticJsonDocument<512> doc;
  doc["device_id"] = "virtual_esp32_01";
  doc["timestamp"] = millis() / 1000;

  JsonObject sensors = doc.createNestedObject("sensors");
  
  // 計算發送給前端的顯示重量（正數剩餘重）：
  // 若未校正，則為原始讀值；若已校正且正在喝水(拿起)，顯示 0；若已校正且放下，顯示剩餘重量
  int display_weight = 0;
  if (!is_calibrated) {
    display_weight = scale.is_ready() ? (int)scale.get_units(1) : 0;
  } else {
    if (is_drinking_state) {
      display_weight = 0;
    } else {
      display_weight = (int)(original_full_weight + current_weight);
      if (display_weight < 0) display_weight = 0;
    }
  }
  
  sensors["weight"]    = display_weight;                // 發送給前端的顯示重量 (g)
  sensors["raw_hx711"] = scale.is_ready() ? (long)scale.get_units(1) : 0; // 即時原始讀取值
  sensors["distance"]  = (int)current_distance;
  sensors["pm25"]      = (int)current_pm25;

  JsonObject status = doc.createNestedObject("status");
  status["is_drinking"]  = is_drinking_state;
  status["calibrated"]   = is_calibrated; // ★ 回傳校正狀態讓前端顯示
  status["original_full_weight"] = (int)original_full_weight;
  status["today_water"] = (int)today_water_intake;
  status["posture"]      = (current_distance < POSTURE_SEVERE_CM) ? "too_close"
                         : (current_distance < POSTURE_MILD_CM)   ? "slouched"
                         : "good";
  status["air_quality"]  = (current_pm25 >= 75) ? "danger"
                         : (current_pm25 >= 35) ? "poor"
                         : "excellent";

  serializeJson(doc, Serial);
  Serial.println();
}

// 執行使用者主動歸零校正 (方案 B：以當前裝滿水狀態為基準歸零)
void performTare() {
  if (!scale.is_ready()) {
    Serial.println("[Tare] ⚠️ HX711 未就緒，歸零失敗！");
    return;
  }

  Serial.println("[Tare] 開始歸零校正 (方案B：以當前裝滿水狀態為基準)...");
  scale.tare(TARE_SAMPLE_COUNT); // 取樣 20 次平均，將當前重量設為 0
  scale.set_scale(420.0);        // 設定換算係數

  is_calibrated = true;
  last_stable_weight = 0.0;
  current_weight = 0.0;
  original_full_weight = 0.0;  // 初始設為 0，等拿起後由狀態機自動校正為實際值
  is_drinking = false;
  lift_confirmed = false;
  prev_read_weight = 99999.0;
  stable_count = 0;

  Serial.println("[Tare] ✅ 裝滿水校正完成！現在可以拿起水杯進行喝水。");

  // 播放雙短音表示校正完成 (v3.x API)
  ledcWriteTone(BUZZER_PIN, 1200);
  ledcWrite(BUZZER_PIN, 200);
  delay(100);
  ledcWrite(BUZZER_PIN, 0);
  ledcWriteTone(BUZZER_PIN, 0);
  delay(80);
  ledcWriteTone(BUZZER_PIN, 1600);
  ledcWrite(BUZZER_PIN, 200);
  delay(100);
  ledcWrite(BUZZER_PIN, 0);
  ledcWriteTone(BUZZER_PIN, 0);
}

void checkIncomingSerial() {
  if (!Serial.available()) return;

  StaticJsonDocument<300> doc;
  DeserializationError err = deserializeJson(doc, Serial);
  if (err) return;

  // ★ 處理使用者主動歸零指令 / 蜂鳴器測試
  if (doc.containsKey("cmd")) {
    String cmd = doc["cmd"].as<String>();
    if (cmd == "tare") {
      performTare();
    } else if (cmd == "test_buzzer") {
      // 播放三段音確認蜂鳴器正常 (Do-Mi-Sol)
      Serial.println("[蜂鳴器] 確認音測試...");
      int testFreqs[] = {523, 659, 784}; // C5, E5, G5
      for (int i = 0; i < 3; i++) {
        ledcWriteTone(BUZZER_PIN, testFreqs[i]);
        ledcWrite(BUZZER_PIN, 200);
        delay(150);
        ledcWrite(BUZZER_PIN, 0);
        ledcWriteTone(BUZZER_PIN, 0);
        delay(60);
      }
      Serial.println("[蜂鳴器] 確認音完成");
    }
    return;
  }

  if (doc.containsKey("status")) {
    JsonObject st = doc["status"];
    if (st.containsKey("posture_stage"))     stage_posture     = st["posture_stage"];
    if (st.containsKey("air_stage"))         stage_air         = st["air_stage"];
    if (st.containsKey("sedentary_stage"))   stage_sedentary   = st["sedentary_stage"];
    if (st.containsKey("dehydration_stage")) stage_dehydration = st["dehydration_stage"];
    calculateWarningCount();
  }
}

// ================= 8. 初始化 =================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n[系統] ESP32 啟動中...");

  // 超音波腳位
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  // 粉塵感測器腳位
  pinMode(DUST_LED_PIN, OUTPUT);
  digitalWrite(DUST_LED_PIN, HIGH);
  pinMode(DUST_ANALOG_PIN, INPUT);

  // 蜂鳴器初始化（ESP32 Core v3.x 新版 API：ledcAttach，不再需要 ledcSetup+ledcAttachPin）
  ledcAttach(BUZZER_PIN, 2000, BUZZER_RES);
  ledcWrite(BUZZER_PIN, 0);

  // 開機測試音：嗶一聲確認蜂鳴器正常
  Serial.println("[蜂鳴器] 開機測試音...");
  ledcWriteTone(BUZZER_PIN, 1000);
  ledcWrite(BUZZER_PIN, 200);
  delay(200);
  ledcWrite(BUZZER_PIN, 0);
  ledcWriteTone(BUZZER_PIN, 0);

  // HX711 秤重模組初始化（僅初始化，不自動歸零）
  Serial.println("[杯墊] 初始化 HX711...");
  scale.begin(HX711_DOUT, HX711_SCK);
  scale.set_scale(420.0); // 預設換算係數，可在歸零後重新設定

  // 等待秤重模組就緒
  int wait_count = 0;
  while (!scale.is_ready() && wait_count < 50) {
    delay(100);
    wait_count++;
    Serial.print(".");
  }
  Serial.println();

  if (scale.is_ready()) {
    Serial.println("[杯墊] ✅ HX711 就緒！");
    Serial.println("[杯墊] ⚠️ 尚未歸零校正，請在網頁按下「歸零校正」按鈕後再使用飲水偵測。");
  } else {
    Serial.println("[杯墊] ⚠️ 警告：HX711 未就緒，請檢查接線！");
  }

  Serial.println("[系統] 初始化完成！請在網頁端點擊「歸零校正」按鈕以啟用飲水偵測。");
}

// ================= 9. 主循環 =================
void loop() {
  // 1. 讀取各感測器
  readDistance();
  bool did_drink = readWeightAndDetectDrink();
  readPM25Direct();

  // 2. 每秒傳送一次感測器封包
  unsigned long now = millis();
  if (now - last_sensor_send >= SEND_INTERVAL) {
    last_sensor_send = now;
    sendSensorPacket(is_drinking);
  }

  // 3. 接收來自電腦的警告階段回饋
  checkIncomingSerial();

  // 4. 本地備援判定（當 Serial 斷線時仍能鳴叫）
  updateLocalWarningStages();
  calculateWarningCount();

  // 5. 控制蜂鳴器
  handleBuzzerSound();

  delay(20);
}
