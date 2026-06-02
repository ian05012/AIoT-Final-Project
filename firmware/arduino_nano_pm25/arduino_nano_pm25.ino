/**
 * 智慧物聯網健康輔助系統 - Arduino Nano 端韌體
 * 
 * 專職驅動 GP2Y1010AU0F 光學粉塵感測器，每秒計算一次 PM2.5 平均值，
 * 並透過 Serial 串口將數據傳送給 ESP32 主控板。
 */

// 腳位宣告
const int measurePin = A0;  // 接 GP2Y1010 5腳 (Vo)
const int ledPower = 12;    // 接 GP2Y1010 3腳 (LED)

// 採樣時序參數
const int delayTime = 280;   // 280微秒後採樣
const int delayTime2 = 40;   // 40微秒後關閉LED
const float offTime = 9680;  // 確保週期為 10ms (100Hz)

// 移動平均濾波參數
const int filterSize = 20;
float readings[filterSize];
int readIndex = 0;
float total = 0;
float average = 0;

void setup() {
  Serial.begin(9600); // 與 ESP32 傳輸時的波特率需一致，NodeMCU 接收設為 9600bps
  pinMode(ledPower, OUTPUT);
  
  // 初始化濾波器陣列
  for (int thisReading = 0; thisReading < filterSize; thisReading++) {
    readings[thisReading] = 0;
  }
}

void loop() {
  // 進行一次採樣
  digitalWrite(ledPower, LOW); // 低電平觸發 (開啟紅外線 LED)
  delayMicroseconds(delayTime);
  
  float dustVal = analogRead(measurePin); // 讀取模擬電壓
  
  delayMicroseconds(delayTime2);
  digitalWrite(ledPower, HIGH); // 關閉紅外線 LED
  delayMicroseconds(offTime);
  
  // 計算電壓值 (5V 參考電壓)
  float voltage = dustVal * (5.0 / 1024.0);
  
  // 根據 Sharp 官方規格計算粉塵濃度 (μg/m³)
  // 關係式：0.17 * 電壓 - 0.1 mg/m³。換算為 μg/m³ 則乘以 1000：
  // 濃度 = 170.0 * 電壓 - 100.0
  float dustDensity = 170.0 * voltage - 100.0;
  if (dustDensity < 0) {
    dustDensity = 0.0;
  }
  
  // 移動平均濾波 (平滑波形，減少雜訊)
  total = total - readings[readIndex];
  readings[readIndex] = dustDensity;
  total = total + readings[readIndex];
  readIndex = readIndex + 1;
  
  if (readIndex >= filterSize) {
    readIndex = 0;
  }
  
  average = total / filterSize;
  
  // 每隔 1 秒向串口輸出一次 PM2.5 數據
  static unsigned long lastSendTime = 0;
  if (millis() - lastSendTime >= 1000) {
    lastSendTime = millis();
    
    // 輸出格式例如：PM25:35.5
    Serial.print("PM25:");
    Serial.println(average, 1);
  }
}
