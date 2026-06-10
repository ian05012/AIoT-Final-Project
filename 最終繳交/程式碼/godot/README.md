# 智慧物聯網健康輔助系統 - Godot 4 桌面寵物實作指南

本專案目錄為期末專案在 **Godot Engine 4** 中的桌面寵物（Desktop Pet）實作。透過將視窗設為透明、無邊框、置頂，史萊姆能真正飄浮在您的 Windows 桌面上。

---

## 🛠️ Godot 4 專案屬性設定步驟

請在 Godot 4 編輯器中進行以下設定，以啟用背景透明與無邊框置頂功能：

1.  **開啟專案設定**：
    *   點選頂部選單 `Project (專案)` -> `Project Settings (專案設定)`。
2.  **設定視窗尺寸與透明無邊框**：
    *   在左側尋找 `Display (顯示)` -> `Window (視窗)`。
    *   **Size (尺寸)**：
        *   `Viewport Width` 設為 `400`
        *   `Viewport Height` 設為 `400`
        *   `Window Width Override` 設為 `400`
        *   `Window Height Override` 設為 `400`
    *   **Flags (標記)**：
        *   `Borderless` (無邊框) 設為 **On (開啟)**
        *   `Always on Top` (永遠置頂) 設為 **On (開啟)**
        *   `Transparent` (視窗透明) 設為 **On (開啟)**
3.  **啟用像素透明允許**：
    *   在同一個 `Window` 頁面下，向下滾動尋找 `Per Pixel Transparency` (每像素透明)。
    *   將 `Allowed` 設為 **On (開啟)**（這是 Windows 系統實現去背的關鍵設定）。
4.  **設定渲染通道 (可選)**：
    *   在左側尋找 `Rendering` -> `Viewport` -> `Transparent Background` 設為 **On (開啟)**。

---

## 🌳 節點樹結構 (Scene Tree)

請在您的 `Main` 場景中建立以下節點結構，並掛載對應的腳本檔案：

```text
Main (Node2D)                <-- 掛載 Main.gd (負責視窗拖曳與透明背景初始化)
  ├── Slime (Node2D)         <-- 掛載 Slime.gd (負責向量繪製史萊姆與動畫狀態機)
  └── Network (Node)         <-- 掛載 Network.gd (負責 WebSocket 連線並解析 JSON)
```

---

## 🏃 執行方式

1.  確認您的 WebSocket 伺服器已啟動（執行專案根目錄的 `python server.py`）。
2.  在 Godot 編輯器中按下 `F5`（或點擊右上角執行按鈕）啟動專案。
3.  您現在可以用**滑鼠左鍵按住史萊姆在桌面上任意拖曳**！
4.  點擊史萊姆可以觸發慢速驚訝彈跳；改變測重或感測器數值，史萊姆亦會在桌面即時變形與變色！
