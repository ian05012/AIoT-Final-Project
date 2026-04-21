
# 智慧物聯網健康輔助系統 (Gamified IoT Desktop Companion for Workplace Health Monitoring)

![Project Status](https://img.shields.io/badge/Status-In_Development-blue)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-lightgrey)
![Engine](https://img.shields.io/badge/Engine-Godot-blue)
![Hardware](https://img.shields.io/badge/Hardware-ESP32%20%7C%20Arduino-green)

## 📖 專案簡介 (Abstract)
隨著數位化工作型態普及，長時間久坐與持續使用電腦已成為現代辦公族群的常態。研究指出，辦公族群平均約有 75% 的工作時間處於坐姿狀態，而久坐與心代謝症候群、肌肉骨骼不適等健康風險高度相關。此外，室內二氧化碳（CO2）濃度過高也會增加嗜睡感並降低認知工作表現。

目前多數的健康提醒工具以單向、定時的通知為主，容易使使用者產生「提醒疲乏」進而忽略警示。為了解決此問題，本專案提出一套**結合物聯網（IoT）感測技術與桌面互動角色**的智慧健康輔助系統。透過「遊戲化 (Gamification)」設計，將使用者的健康行為與虛擬角色狀態連動，提供具互動性且低干擾的即時回饋，以協助使用者建立良好的日常工作習慣。

## ✨ 核心功能 (Features)

### 1. 多元 IoT 環境與行為感測
*   **飲水行為偵測**：桌面設置配備測重模組（Load Cell）的智慧杯墊，即時追蹤水杯重量變化以記錄飲水行為。
*   **姿勢狀態監測**：結合超音波感測器（測量與螢幕距離）與 IMU 慣性感測器（偵測身體傾角），當使用者過度前傾或久坐不動時觸發警示。
*   **室內空氣品質監測**：配置 CO2 氣體感測器（如 MH-Z19 或 CCS811），當濃度超過 1000 ppm（需注意通風的參考值）時發送環境惡化訊號。

### 2. 桌面互動與遊戲化設計
*   **狀態連動機制**：使用 Godot Engine 開發 2D 像素風格（Pixel Art）桌面角色。當偵測到喝水時角色會表現開心；CO2 過高時角色會呈現頭暈；姿勢不良時則呈現疲勞。
*   **非干擾式設計**：角色以半透明或極小化懸浮於桌面邊緣，支援「穿透模式」避免干擾滑鼠點擊。僅在健康指標低於安全閥值時主動爭取注意力（Attention Getter）。
*   **遊戲化回饋**：內建積分機制，維持良好坐姿、定時喝水與通風即可累積「健康值」，解鎖角色新外觀與特殊動畫。

## 🔬 理論基礎與相關研究 (Related Works)
本系統之設計奠基於以下學術研究發現：
1.  **辦公久坐介入**：單純的提醒機制不如結合個人與環境層級的綜合策略有效，本系統整合硬體感測與軟體互動，提供情境化的改善方案。
2.  **環境影響感知**：將 CO2 濃度監測納入系統，直接回應高 CO2 對於專注力下降與睡意增加的負面影響。
3.  **遊戲化 (Gamification) 的有效性**：系統性回顧與 Meta-analysis 顯示，遊戲化介入對於改變健康相關行為（如增加身體活動）具有中等程度的正向效果（Hedges' g = 0.42）。遊戲化設計能有效提升使用者動機，並減少對傳統提醒機制的疲乏感。

## 🛠️ 系統架構 (System Architecture)

本系統架構分為**感測端**與**桌面互動端**，採用分散式 IoT 架構，實現低延遲的資料傳輸：

*   **硬體端 (Hardware)**：以微控制器（ESP32 或 Arduino）作為核心，收集 Load Cell、超音波感測器、IMU 及 CO2 感測器的類比與數位訊號。
*   **通訊協定 (Communication)**：硬體端透過 Wi-Fi 模組，以 MQTT 或 WebSocket 協定將 JSON 格式的數據即時推播至電腦端。
*   **軟體端 (Software)**：桌面虛擬角色狀態機（State Machine）接收數據後轉換為視覺回饋。未來亦規畫導入**模型上下文協定 (Model Context Protocol, MCP)** 無縫串接大型語言模型 (LLM)，以生成個人化對話或語音提醒。

## 🚀 安裝與執行 (Installation & Setup)
*(待專案開發完成後補上詳細的環境設定、硬體接線圖與安裝指令)*
1. Clone this repository: `git clone https://github.com/your-repo/smart-health-companion.git`
2. Hardware setup: Upload the C++ code to ESP32 using Arduino IDE.
3. Software setup: Open the Godot project file and export the executable.

## 🎯 預期成效 (Expected Outcomes)
預期本系統能顯著提升使用者對健康提醒的關注度與執行意願，並透過非干擾式與遊戲化的設計，降低辦公過程中的提醒疲乏現象，進而促進辦公族群建立良好生活習慣，提升整體健康與工作效率。

## 👥 開發團隊 (Team)
*   張哲維 
*   張子善 
*   林鈺紳 
*(註：本專案為智慧物聯網應用與實作期中提案)*

## 📄 授權 (License)
[MIT License](LICENSE)
