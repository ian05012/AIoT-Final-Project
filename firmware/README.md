# 智慧物聯網健康輔助系統 - 硬體整合與電路接線指南

本文件旨在指導如何將您的硬體設備（ESP32、Arduino Nano、HC-SR04 超音波、HX711 智慧杯墊、無源蜂鳴器、GP2Y1010AU0F 空氣感測器）整合為一個系統，並提供詳細的電路接線與運作機制說明。

---

## 📐 系統整合架構

由於 **GP2Y1010AU0F PM2.5/粉塵感測器** 在讀取時需要非常精確的微秒級（$\mu\text{s}$）脈衝控制與類比採樣（在發光二極體開啟後 280 微秒進行 Analog 讀取，並在 320 微秒時關閉），這在運行 Wi-Fi 與 WebSocket 連線的 ESP32 上容易因中斷干擾而產生雜訊與誤判。

因此，**「由 Arduino Nano 負責讀取 PM2.5，並透過 UART 串口傳輸給 ESP32」** 是一個非常優秀且穩定的硬體架構設計！

### 運作流程：
1. **Arduino Nano**：專職驅動 GP2Y1010AU0F，每秒計算一次 PM2.5 濃度，格式化為 `PM25:<數值>\n` 透過 TX 腳位發送。
2. **ESP32 主控**：
   * 讀取本地的 **HC-SR04 超音波距離** 與 **HX711 重量數據**。
   * 透過硬體串口 2 (Serial2, RX2) 接收來自 Nano 的 PM2.5 數據。
   * 本地進行多重健康警告判定（統計 active warnings 數量）。
   * 驅動**無源蜂鳴器**發出對應音高與頻率的警報。
   * 將所有感測器數值封裝成 JSON，透過 Wi-Fi 以 WebSocket 發送至本地 PC。

---

## 🚀 無法直接對接時的解決方案：USB 串口中繼機制 (PC-Relay Mode)

如果您的 **Arduino Nano 與 GP2Y1010AU0F 已經固定或黏死在方盒內部**，導致無法拉杜邦線與 ESP32 連接，您**完全不需要強行拆卸硬體**！

我們已經在 PC 端的 WebSocket 伺服器（`server.py`）中加入了 **USB 串口掃描與中繼機制**。

### 🔌 PC-Relay 運作機制與接線
1. **Arduino Nano 盒**：使用 Nano 內建的 USB 傳輸線，直接插入 **PC 的 USB 槽**。這既能供電，也能將 PM2.5 資料透過 USB 的 COM Port 送給 PC。
2. **ESP32 主控**：將 HC-SR04、HX711 與無源蜂鳴器接在 ESP32 上，並以 Wi-Fi 將距離與重量發給 PC。
3. **PC 伺服器 (server.py)**：
   * 在背景啟動 Serial 監聽（需 `pip install pyserial`），會**自動掃描並連線**至您的 Arduino Nano USB 串口。
   * 從串口讀取 PM2.5 值後，PC 伺服器會自動將資料轉化為 WebSocket 廣播封包發送。
   * ESP32 主控會經由 WebSocket 收到這個廣播值（與久坐/缺水指標一同接收），並在本地觸發無源蜂鳴器鳴叫。
   
> **如此一來，兩塊開發板不需要接任何一條實體線，即可完美透過 PC 端的 WebSocket 伺服器完成無線資料整合與實體蜂鳴器警報！**

---

## 🔌 電路接線圖 (Wiring Schema)

> [!WARNING]
> **電位防護注意 (Level Shifting)**
> * Arduino Nano 的工作電壓為 **5V**，其 TX 腳位輸出高電平為 5V。
> * ESP32 的工作與 I/O 電壓為 **3.3V**，GPIO 腳位**不耐 5V**。
> * **安全接法**：Arduino Nano TX 連接至 ESP32 RX2時，**必須經過分壓電阻**（例如：在訊號線與地之間接 2kΩ，訊號線與 Nano TX 之間接 1kΩ，分壓點接 ESP32 RX2），將 5V 降為約 3.3V。

### 1. 全系統接線對照表

| 感測器/模組 | 模組腳位 | 微控制器腳位 (ESP32 / Nano) | 供電與備註 |
| :--- | :--- | :--- | :--- |
| **Arduino Nano (PM2.5專職)** | **TX** | **ESP32 RX2 (GPIO16)** | ⚠️ 需經分壓電阻降壓至 3.3V |
| | **GND** | **ESP32 GND** | ⚠️ **共地線非常重要**，否則串口無法收發！ |
| | **VIN / 5V** | **5V 供電** | 可由各自 USB 供電，或 ESP32 5V 接 Nano 5V/VIN |
| **GP2Y1010AU0F (接 Nano)** | V-LED (Pin 1) | 5V (串聯 150Ω 電阻) | 需在 Pin 1 與 Pin 2 之間並聯 220µF 電容 |
| | LED-GND (Pin 2) | Nano GND | |
| | LED (Pin 3) | **Nano D12** | 控制 LED 開關脈衝 |
| | S-GND (Pin 4) | Nano GND | |
| | Vo (Pin 5) | **Nano A0** | 讀取粉塵模擬電壓 |
| | Vcc (Pin 6) | Nano 5V | |
| **HC-SR04 超音波 (接 ESP32)**| VCC | ESP32 5V (或 3.3V，若為 HC-SR04P) | |
| | GND | ESP32 GND | |
| | TRIG | **ESP32 GPIO22** | |
| | ECHO | **ESP32 GPIO23** | ⚠️ 若為 5V 版 HC-SR04，ECHO 需分壓至 3.3V |
| **HX711 秤重模組 (接 ESP32)**| VCC / VDD | ESP32 3.3V | 確保 I/O 電平為 3.3V |
| | GND | ESP32 GND | |
| | DT (Data) | **ESP32 GPIO19** | |
| | SCK (Clock)| **ESP32 GPIO18** | |
| | 傳感器端 | 紅線(E+)、黑線(E-)、白線(A-)、綠線(A+) | 接 5kg 秤重傳感器 |
| **無源蜂鳴器 (接 ESP32)** | VCC | ESP32 3.3V (或 5V) | |
| | GND | ESP32 GND | |
| | I/O (PWM) | **ESP32 GPIO21** | 使用 PWM 訊號控制音高 |

---

## 🎛️ 分壓電路接線圖 (Nano TX -> ESP32 RX2)

若您沒有雙向電平轉換模組（Level Shifter），請使用兩個電阻進行簡易分壓：

```text
Nano TX [5V] -----[ 1kΩ 電阻 ]-----+----- ESP32 RX2 (GPIO16) [3.3V]
                                   |
                             [ 2kΩ 電阻 ]
                                   |
Nano GND --------------------------+----- ESP32 GND
```

---

## 📂 專案程式碼目錄結構

本專案將硬體韌體代碼分類存放於專案 root 下的 `/firmware` 目錄中：
*   **`arduino_nano_pm25/`**：包含 Nano 讀取 GP2Y1010AU0F 與串口發送程式。
*   **`esp32_companion/`**：包含 ESP32 主控程式（Wi-Fi、WebSocket、HX711、HC-SR04、Buzzer 與串口接收）。
