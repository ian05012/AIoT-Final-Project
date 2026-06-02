// WebSocket 連線管理
let socket = null;
const WS_URL = `ws://${window.location.hostname || "localhost"}:3000`;
const reconnectInterval = 3000;

// 感測器狀態數據 (預設正常值)
const state = {
    weight: 350,       // 水杯重量 (g)
    distance: 60,      // 超音波距離 (cm)
    pm25: 15,          // PM2.5 粉塵濃度 (μg/m³)
    time: 0,           // 久坐時間 (分鐘)
    noWaterTime: 0,    // 久未飲水時間 (分鐘)
    
    // 危害狀態布林值 (支援多重疊加)
    health: 10,        // 健康值 (0-10)
    isDrinking: false, // 是否正在喝水
    isEating: false,   // 是否正在吃水果
    currentEatColor: null, // 目前吃的水果顏色
    isHappy: false,    // 是否正處於喝完水的開心期
    isSlouched: false, // 是否姿勢不良 (距離太近)
    selectedPet: "slime", // 當前選取的角色：slime, cat, ghost, chick, bubble
    isSuffocating: false, // 是否空氣品質危險
    isTired: false,    // 是否久坐警告
    isDehydrated: false, // 是否脫水 (健康度低於 5)
    
    // 階段性狀態 (0 = 正常, 1 = 輕微危害, 2 = 嚴重危害)
    postureStage: 0,
    dehydrationStage: 0,
    sedentaryStage: 0,
    airStage: 0,
    
    isMouseHovering: false,  // 滑鼠是否懸停在史萊姆身上
    actionState: "IDLE",     // 目前主要顯示的行為
    todayWater: 0,     // 今日飲水量 (ml)
    prevWeight: 350,   // 上次重量 (用來偵測喝水)
    
    // 蜂鳴器相關狀態
    buzzerMuted: true,        // 是否靜音 (預設靜音)
    activeWarningCount: 0     // 當前健康警告的個數
};

// 史萊姆座標與隨機跳動狀態
const slimePos = {
    x: 200,
    y: 260,
    startX: 200,
    startY: 260,
    targetX: 200,
    targetY: 260,
    isJumping: false,
    jumpProgress: 0,
    jumpTimer: 100,    // 距離下次跳躍的時間 (幀)
    squashCount: 0,    // 落地壓扁的幀數
    jumpHeight: 60,    // 跳躍高度
    pokeTimer: 0       // 戳戳驚訝與形變的剩餘幀數
};

// Canvas 與動畫設定
const canvas = document.getElementById("steve-canvas");
const ctx = canvas.getContext("2d");
let animationFrameId = null;
let animTime = 0; // 動畫計時器
const particles = []; // 粒子特效數組

// 粒子類別
class Particle {
    constructor(x, y, type, color = null) {
        this.x = x;
        this.y = y;
        this.type = type; // 'water', 'poison', 'sleep', 'tear', 'heart', 'crumb'
        this.color = color;
        
        // 依據不同粒子設定初始速度與生命週期
        if (type === 'tear') {
            // 眼淚左右噴出拋物線
            this.vx = (x < slimePos.x) ? -1.5 - Math.random() : 1.5 + Math.random();
            this.vy = -2 - Math.random() * 2;
            this.gravity = 0.18;
            this.size = 3 + Math.random() * 3;
            this.maxLife = 35 + Math.random() * 15;
        } else if (type === 'heart') {
            // 開心愛心往上飄移
            this.vx = (Math.random() - 0.5) * 1.5;
            this.vy = -1.5 - Math.random() * 1.5;
            this.size = 10;
            this.maxLife = 50 + Math.random() * 20;
        } else if (type === 'sleep') {
            // Zzz 往上飄移
            this.vx = 0.5 + Math.random() * 0.5;
            this.vy = -1 - Math.random();
            this.size = 12;
            this.maxLife = 80 + Math.random() * 20;
        } else if (type === 'crumb') {
            // 水果碎屑拋物線/散射
            this.vx = (Math.random() - 0.5) * 4;
            this.vy = -1.5 - Math.random() * 2.5;
            this.gravity = 0.15;
            this.size = 2 + Math.random() * 3;
            this.maxLife = 25 + Math.random() * 15;
        } else {
            // 水滴或毒氣氣泡
            this.vx = (Math.random() - 0.5) * 2;
            this.vy = type === 'water' ? -2 - Math.random() : (Math.random() - 0.5) * 1.5;
            this.size = 3 + Math.random() * 4;
            this.maxLife = 40 + Math.random() * 20;
        }
        
        this.alpha = 1;
        this.life = 0;
    }

    update() {
        if (this.type === 'tear' || this.type === 'crumb') {
            this.vy += this.gravity; // 受重力影響
        }
        this.x += this.vx;
        this.y += this.vy;
        this.life++;
        this.alpha = 1 - (this.life / this.maxLife);
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        
        if (this.type === 'water') {
            // 水滴
            ctx.fillStyle = "#55aaff";
            ctx.fillRect(this.x, this.y, this.size, this.size);
        } 
        else if (this.type === 'poison') {
            // 毒霧泡泡
            ctx.fillStyle = "rgba(162, 61, 255, 0.4)";
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        } 
        else if (this.type === 'sleep') {
            // Zzz
            ctx.fillStyle = "#ffffff";
            ctx.font = `bold ${this.size}px 'Press Start 2P', monospace`;
            ctx.fillText("Z", this.x, this.y);
        } 
        else if (this.type === 'tear') {
            // 眼淚粒子
            ctx.fillStyle = "#8adcff";
            ctx.fillRect(this.x, this.y, this.size, this.size * 1.5);
        } 
        else if (this.type === 'heart') {
            // 開心愛心
            ctx.fillStyle = "#ff4da6";
            ctx.beginPath();
            ctx.moveTo(this.x, this.y + 3);
            ctx.bezierCurveTo(this.x - 3, this.y - 3, this.x - 6, this.y - 3, this.x - 6, this.y + 3);
            ctx.bezierCurveTo(this.x - 6, this.y + 7, this.x - 3, this.y + 10, this.x, this.y + 13);
            ctx.bezierCurveTo(this.x + 3, this.y + 10, this.x + 6, this.y + 7, this.x + 6, this.y + 3);
            ctx.bezierCurveTo(this.x + 6, this.y - 3, this.x + 3, this.y - 3, this.x, this.y + 3);
            ctx.fill();
        }
        else if (this.type === 'crumb') {
            // 水果碎屑
            ctx.fillStyle = this.color || "#ff0000";
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.restore();
    }
}

// 繪製並更新所有粒子
function updateAndDrawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.update();
        if (p.alpha <= 0) {
            particles.splice(i, 1);
        } else {
            p.draw(ctx);
        }
    }
}

const FRUITS = [
    { type: 'apple', name: '蘋果 🍎', color: '#ff3b30', crumbColor: '#ff4f43' },
    { type: 'orange', name: '橘子 🍊', color: '#ff9500', crumbColor: '#ffa524' },
    { type: 'grape', name: '葡萄 🍇', color: '#af52de', crumbColor: '#be6beb' },
    { type: 'banana', name: '香蕉 🍌', color: '#ffcc00', crumbColor: '#ffd624' },
    { type: 'cherry', name: '櫻桃 🍒', color: '#ff2d55', crumbColor: '#ff4f72' }
];

// 食物水滴數組與更新繪製
const foods = [];
function updateAndDrawFoods() {
    for (let i = foods.length - 1; i >= 0; i--) {
        const f = foods[i];
        if (!f.active) {
            foods.splice(i, 1);
            continue;
        }
        
        // 受到重力下墜
        if (f.y < 280) { // 280 像素為地面高度
            f.vy += 0.25; // 重力加速度
            f.y += f.vy;
        } else {
            f.y = 280;
            f.vy = 0;
        }
        
        ctx.save();
        
        // 根據水果種類繪製不同的圖形
        if (f.fruit) {
            const fx = f.x;
            const fy = f.y;
            
            if (f.fruit.type === 'apple') {
                // 蘋果 🍎
                ctx.fillStyle = "#ff3b30";
                ctx.beginPath();
                // 畫左半圓和右半圓
                ctx.arc(fx - 4, fy - 1, 6, 0, Math.PI * 2);
                ctx.arc(fx + 4, fy - 1, 6, 0, Math.PI * 2);
                ctx.fill();
                // 底部稍微收細
                ctx.beginPath();
                ctx.arc(fx, fy + 3, 5, 0, Math.PI * 2);
                ctx.fill();
                
                // 果蒂 (蒂頭)
                ctx.strokeStyle = "#8b5a2b";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(fx, fy - 5);
                ctx.quadraticCurveTo(fx + 2, fy - 10, fx + 4, fy - 11);
                ctx.stroke();
                
                // 葉子
                ctx.fillStyle = "#34c759";
                ctx.beginPath();
                ctx.ellipse(fx + 4, fy - 10, 3, 1.5, Math.PI / 4, 0, Math.PI * 2);
                ctx.fill();
                
                // 高光
                ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
                ctx.beginPath();
                ctx.arc(fx - 3, fy - 3, 1.5, 0, Math.PI * 2);
                ctx.fill();
            } 
            else if (f.fruit.type === 'orange') {
                // 橘子 🍊
                ctx.fillStyle = "#ff9500";
                ctx.beginPath();
                ctx.arc(fx, fy, 7, 0, Math.PI * 2);
                ctx.fill();
                
                // 蒂頭/葉子
                ctx.strokeStyle = "#5c8e32";
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(fx, fy - 7);
                ctx.lineTo(fx, fy - 9);
                ctx.stroke();
                
                ctx.fillStyle = "#4cd964";
                ctx.beginPath();
                ctx.ellipse(fx + 2, fy - 9, 2, 1, -Math.PI / 6, 0, Math.PI * 2);
                ctx.fill();
                
                // 表皮小點與高光
                ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
                ctx.beginPath();
                ctx.arc(fx - 2, fy - 2, 1.5, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.fillStyle = "#d4751c";
                ctx.beginPath();
                ctx.arc(fx + 3, fy + 2, 0.7, 0, Math.PI * 2);
                ctx.arc(fx - 3, fy + 3, 0.7, 0, Math.PI * 2);
                ctx.fill();
            } 
            else if (f.fruit.type === 'grape') {
                // 葡萄 🍇
                ctx.fillStyle = "#af52de";
                // 繪製幾顆交疊的葡萄
                ctx.beginPath(); ctx.arc(fx - 4, fy - 3, 4, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(fx + 4, fy - 3, 4, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(fx, fy + 3, 4, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(fx, fy - 5, 4, 0, Math.PI * 2); ctx.fill();
                
                // 蒂頭
                ctx.strokeStyle = "#5c8e32";
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(fx, fy - 8);
                ctx.quadraticCurveTo(fx + 2, fy - 12, fx + 5, fy - 11);
                ctx.stroke();
            } 
            else if (f.fruit.type === 'banana') {
                // 香蕉 🍌
                ctx.strokeStyle = "#ffcc00";
                ctx.lineWidth = 4.5;
                ctx.lineCap = "round";
                ctx.beginPath();
                // 畫一條彎曲的弧線
                ctx.arc(fx - 2, fy - 6, 10, 0.15 * Math.PI, 0.85 * Math.PI);
                ctx.stroke();
                
                // 香蕉尖端黑色/褐色蒂頭
                ctx.fillStyle = "#5c4033";
                ctx.beginPath();
                ctx.arc(fx - 2 + 10 * Math.cos(0.15 * Math.PI), fy - 6 + 10 * Math.sin(0.15 * Math.PI), 1.5, 0, Math.PI * 2);
                ctx.arc(fx - 2 + 10 * Math.cos(0.85 * Math.PI), fy - 6 + 10 * Math.sin(0.85 * Math.PI), 1.8, 0, Math.PI * 2);
                ctx.fill();
            } 
            else if (f.fruit.type === 'cherry') {
                // 櫻桃 🍒
                // 兩個紅色小球
                ctx.fillStyle = "#ff2d55";
                ctx.beginPath();
                ctx.arc(fx - 4, fy + 2, 4.5, 0, Math.PI * 2);
                ctx.arc(fx + 4, fy + 2, 4.5, 0, Math.PI * 2);
                ctx.fill();
                
                // 高光
                ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
                ctx.beginPath();
                ctx.arc(fx - 5, fy, 1, 0, Math.PI * 2);
                ctx.arc(fx + 3, fy, 1, 0, Math.PI * 2);
                ctx.fill();
                
                // 綠色果蒂連接到上方
                ctx.strokeStyle = "#4cd964";
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(fx - 4, fy - 1);
                ctx.quadraticCurveTo(fx - 2, fy - 6, fx, fy - 7);
                ctx.moveTo(fx + 4, fy - 1);
                ctx.quadraticCurveTo(fx + 2, fy - 6, fx, fy - 7);
                ctx.stroke();
                
                // 果蒂頂部葉子
                ctx.fillStyle = "#34c759";
                ctx.beginPath();
                ctx.ellipse(fx - 2, fy - 8, 2, 1, -Math.PI / 4, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            // 備用：舊有的水滴繪製
            ctx.fillStyle = "#3da5ff";
            ctx.strokeStyle = "#156fcc";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(f.x, f.y - 12);
            ctx.bezierCurveTo(f.x - 6, f.y - 4, f.x - 6, f.y + 4, f.x, f.y + 4);
            ctx.bezierCurveTo(f.x + 6, f.y + 4, f.x + 6, f.y - 4, f.x, f.y - 12);
            ctx.fill();
            ctx.stroke();
        }
        
        ctx.restore();
    }
}

// 初始化 DOM 元素
const elSliderWeight = document.getElementById("slider-weight");
const elValWeight = document.getElementById("val-weight");
const elSliderDistance = document.getElementById("slider-distance");
const elValDistance = document.getElementById("val-distance");
const elSliderPM25 = document.getElementById("slider-pm25");
const elValPM25 = document.getElementById("val-pm25");
const elSliderTime = document.getElementById("slider-time");
const elValTime = document.getElementById("val-time");
const elSliderNoWater = document.getElementById("slider-no-water");
const elValNoWater = document.getElementById("val-no-water");

const elBtnDrink = document.getElementById("btn-drink");
const elBtnRefill = document.getElementById("btn-refill");
const elBtnDry = document.getElementById("btn-dry");
const elBtnSlouch = document.getElementById("btn-slouch");
const elBtnGoodPosture = document.getElementById("btn-good-posture");
const elBtnHighPM25 = document.getElementById("btn-high-pm25");
const elBtnSedentary = document.getElementById("btn-sedentary");
const elBtnResetTimer = document.getElementById("btn-reset-timer");

const elWsStatus = document.getElementById("ws-status");
const elHeartsContainer = document.getElementById("hearts-container");
const elMetricWater = document.getElementById("metric-water");
const elMetricPosture = document.getElementById("metric-posture");
const elMetricAir = document.getElementById("metric-air");
const elMetricAction = document.getElementById("metric-action");

const elAirPoison = document.getElementById("air-poison");
const elConsoleLog = document.getElementById("console-log");
const elBtnClearConsole = document.getElementById("btn-clear-console");
const elBtnToggleBuzzer = document.getElementById("btn-toggle-buzzer");
const elBuzzerStatusIndicator = document.getElementById("buzzer-status-indicator");

// 建立心形血量條
function updateHeartsUI() {
    elHeartsContainer.innerHTML = "";
    const fullHearts = Math.floor(state.health);
    for (let i = 0; i < 10; i++) {
        const heartSpan = document.createElement("span");
        heartSpan.classList.add("heart");
        if (i < fullHearts) {
            heartSpan.innerText = "❤️";
        } else {
            heartSpan.classList.add("empty");
            heartSpan.innerText = "🖤";
        }
        elHeartsContainer.appendChild(heartSpan);
    }
}

// Web Audio API 蜂鳴器控制
let audioCtx = null;
let buzzerIntervalId = null;
let currentBuzzerInterval = null;
let currentBuzzerFreq = null;

function playBeep(freq, durationMs) {
    if (state.buzzerMuted) return;
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.type = 'square';
        osc.frequency.value = freq;
        
        const now = audioCtx.currentTime;
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.15, now + 0.01);
        gainNode.gain.setValueAtTime(0.15, now + (durationMs / 1000) - 0.01);
        gainNode.gain.linearRampToValueAtTime(0, now + (durationMs / 1000));
        
        osc.start(now);
        osc.stop(now + (durationMs / 1000));
    } catch (err) {
        console.error("Audio beep error:", err);
    }
}

function updateBuzzer() {
    // 如果靜音，或者沒有警告，則停止鳴叫
    if (state.buzzerMuted || state.activeWarningCount === 0) {
        if (buzzerIntervalId) {
            clearInterval(buzzerIntervalId);
            buzzerIntervalId = null;
        }
        currentBuzzerInterval = null;
        currentBuzzerFreq = null;
        
        if (elBuzzerStatusIndicator) {
            elBuzzerStatusIndicator.innerText = state.buzzerMuted ? "MUTED" : "OFF";
            elBuzzerStatusIndicator.style.color = "var(--color-text-dim)";
        }
        return;
    }
    
    // 根據警告個數決定頻率 (Pitch) 與間隔 (Beep Interval)
    let freq = 440;
    let interval = 2000;
    let desc = "輕度";
    
    if (state.activeWarningCount === 1) {
        freq = 440;
        interval = 2000;
        desc = "輕度";
    } else if (state.activeWarningCount === 2) {
        freq = 660;
        interval = 1000;
        desc = "中度";
    } else if (state.activeWarningCount === 3) {
        freq = 880;
        interval = 500;
        desc = "強烈";
    } else if (state.activeWarningCount >= 4) {
        freq = 1200;
        interval = 250;
        desc = "緊急";
    }
    
    if (elBuzzerStatusIndicator) {
        elBuzzerStatusIndicator.innerText = `${desc} (${freq}Hz | ${interval/1000}s)`;
        elBuzzerStatusIndicator.style.color = "var(--color-gold)";
    }
    
    // 如果頻率或間隔改變了，或者計時器尚未啟動，則重新啟動
    if (buzzerIntervalId === null || currentBuzzerInterval !== interval || currentBuzzerFreq !== freq) {
        if (buzzerIntervalId) {
            clearInterval(buzzerIntervalId);
        }
        
        currentBuzzerInterval = interval;
        currentBuzzerFreq = freq;
        
        // 立即發聲一次
        playBeep(freq, 100);
        
        buzzerIntervalId = setInterval(() => {
            playBeep(freq, 100);
        }, interval);
    }
}

// 連線 WebSocket 伺服器
function connectWebSocket() {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        elWsStatus.querySelector(".status-dot").className = "status-dot connected";
        elWsStatus.querySelector(".status-text").innerText = "WS CONNECTED";
        logConsole("SYSTEM", "WebSocket 連線成功！已加入廣播通道。", "inbound");
        sendPacket();
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            logConsole("INCOMING PACKET", JSON.stringify(data, null, 2), "inbound");
            
            if (data.device_id === "virtual_esp32_01" || data.device_id === "virtual_esp32_other") {
                updateStateFromPacket(data);
            }
        } catch (e) {
            console.error("解析 JSON 錯誤: ", e);
        }
    };

    socket.onclose = () => {
        elWsStatus.querySelector(".status-dot").className = "status-dot disconnected";
        elWsStatus.querySelector(".status-text").innerText = "WS DISCONNECTED";
        logConsole("SYSTEM", "WebSocket 連線中斷，正在嘗試重新連線...", "outbound");
        setTimeout(connectWebSocket, reconnectInterval);
    };

    socket.onerror = (err) => {
        console.error("WS 連線錯誤:", err);
    };
}

// 更新本地狀態並同步控制項 UI
function updateStateFromPacket(packet) {
    state.weight = packet.sensors.weight;
    state.distance = packet.sensors.distance;
    state.pm25 = packet.sensors.pm25;
    state.time = packet.status.sedentary_minutes;
    if (packet.status.no_water_minutes !== undefined) {
        state.noWaterTime = packet.status.no_water_minutes;
    }
    
    elSliderWeight.value = state.weight;
    elValWeight.innerText = `${state.weight}g`;
    elSliderDistance.value = state.distance;
    elValDistance.innerText = `${state.distance}cm`;
    elSliderPM25.value = state.pm25;
    elValPM25.innerText = `${state.pm25} μg/m³`;
    elSliderTime.value = state.time;
    elValTime.innerText = `${state.time} min`;
    elSliderNoWater.value = state.noWaterTime;
    elValNoWater.innerText = `${state.noWaterTime} min`;

    processThresholds();
}

// 狀態判定引擎
let drinkTimer = null;
let happyTimer = null;
let eatTimer = null;
function processThresholds() {
    // 1. 喝水判定：水杯重量減少超過 50g
    if (state.prevWeight - state.weight >= 50) {
        if (!state.isDrinking) {
            state.isDrinking = true;
            state.isHappy = false; // 喝水中先關閉開心
            
            // 喝水時將久未飲水時間歸零
            state.noWaterTime = 0;
            elSliderNoWater.value = 0;
            elValNoWater.innerText = "0 min";
            
            const ml = state.prevWeight - state.weight;
            state.todayWater += ml;
            state.health = Math.min(10, state.health + 1.5); // 喝水補血
            
            // 2.5 秒喝水動畫
            if (drinkTimer) clearTimeout(drinkTimer);
            drinkTimer = setTimeout(() => {
                state.isDrinking = false;
                state.prevWeight = state.weight;
                
                // 喝完水後進入「開心開花狀態」
                state.isHappy = true;
                if (happyTimer) clearTimeout(happyTimer);
                happyTimer = setTimeout(() => {
                    state.isHappy = false;
                }, 2500);
                
                logConsole("APP EVENT", "飲水完成，史萊姆感到非常開心！", "outbound");
            }, 2500);
            
            logConsole("APP EVENT", `檢測到飲水行為！飲水量: ${ml} ml。今日累計: ${state.todayWater} ml`, "outbound");
        }
    } else if (state.weight > state.prevWeight) {
        state.prevWeight = state.weight;
    }

    // 2. 坐姿判定 (距離判定，階段性)
    state.isSlouched = (state.distance < 35);
    if (state.distance < 25) {
        state.postureStage = 2; // 嚴重坐姿不良 (距離太近)
        document.getElementById("card-posture").className = "metric-card alert";
        elMetricPosture.innerText = "SEVERE (距離太近)";
    } else if (state.isSlouched) {
        state.postureStage = 1; // 輕微坐姿不良 (距離較近)
        document.getElementById("card-posture").className = "metric-card alert";
        elMetricPosture.innerText = "MILD (距離較近)";
    } else {
        state.postureStage = 0;
        document.getElementById("card-posture").className = "metric-card good";
        elMetricPosture.innerText = "GOOD (端正)";
    }

    // 3. 空氣品質判定 (PM2.5 粉塵，階段性)
    state.isSuffocating = (state.pm25 >= 75);
    if (state.isSuffocating) {
        state.airStage = 2;
        elAirPoison.style.backgroundColor = "rgba(162, 61, 255, 0.25)"; // 毒紫色霧霾
        document.getElementById("card-air").className = "metric-card alert";
        elMetricAir.innerText = "DANGEROUS (紫爆危害)";
    } else if (state.pm25 >= 35) {
        state.airStage = 1;
        elAirPoison.style.backgroundColor = "rgba(162, 61, 255, 0.1)"; // 微紫色
        document.getElementById("card-air").className = "metric-card alert";
        elMetricAir.innerText = "POOR (橘警偏高)";
    } else {
        state.airStage = 0;
        elAirPoison.style.backgroundColor = "rgba(162, 61, 255, 0)";
        document.getElementById("card-air").className = "metric-card good";
        elMetricAir.innerText = "EXCELLENT (良好)";
    }

    // 4. 久坐判定 (階段性)
    state.isTired = (state.time >= 60);
    if (state.time >= 120) {
        state.sedentaryStage = 2; // 嚴重久坐 (昏睡)
        document.getElementById("group-time").style.borderColor = "var(--color-redstone)";
    } else if (state.isTired) {
        state.sedentaryStage = 1; // 輕微久坐 (疲累)
        document.getElementById("group-time").style.borderColor = "var(--color-gold)";
    } else {
        state.sedentaryStage = 0;
        document.getElementById("group-time").style.borderColor = "#2d2d2d";
    }

    // 5. 脫水判定 (階段性，結合時間與健康度)
    state.isDehydrated = (state.noWaterTime >= 60 || state.health <= 5);
    if (state.noWaterTime >= 120 || state.health <= 3) {
        state.dehydrationStage = 2; // 嚴重脫水
        document.getElementById("card-hydration").className = "metric-card alert";
    } else if (state.isDehydrated) {
        state.dehydrationStage = 1; // 輕微脫水
        document.getElementById("card-hydration").className = "metric-card alert";
    } else {
        state.dehydrationStage = 0;
        document.getElementById("card-hydration").className = "metric-card good";
    }

    // 6. 設定主要行為狀態名稱 (用於儀表板，基於優先權級聯)
    if (state.airStage === 2) {
        state.actionState = "SUFFOCATING";
    } else if (state.dehydrationStage === 2) {
        state.actionState = "DEHYDRATED_SEVERE";
    } else if (state.postureStage === 2) {
        state.actionState = "TOO_CLOSE";
    } else if (state.sedentaryStage === 2) {
        state.actionState = "EXHAUSTED";
    } else if (state.airStage === 1) {
        state.actionState = "AIR_POOR";
    } else if (state.dehydrationStage === 1) {
        state.actionState = "DEHYDRATED_MILD";
    } else if (state.postureStage === 1) {
        state.actionState = "CLOSE";
    } else if (state.sedentaryStage === 1) {
        state.actionState = "TIRED";
    } else if (state.isEating) {
        state.actionState = "EATING";
    } else if (state.isDrinking) {
        state.actionState = "DRINKING";
    } else if (state.isHappy) {
        state.actionState = "HAPPY";
    } else {
        state.actionState = "IDLE";
    }

    elMetricWater.innerText = `${state.todayWater} / 2000 ml`;
    elMetricAction.innerText = state.actionState;
    updateHeartsUI();

    // 7. 計算當前觸發警告的項目總數 (Stage >= 1)
    let warnings = 0;
    if (state.postureStage > 0) warnings++;
    if (state.airStage > 0) warnings++;
    if (state.sedentaryStage > 0) warnings++;
    if (state.dehydrationStage > 0) warnings++;
    state.activeWarningCount = warnings;

    // 8. 更新蜂鳴器發聲邏輯
    updateBuzzer();
}

// 定時健康值扣減與模擬器演化 (每 2.5 秒進行一次判定)
setInterval(() => {
    if (state.isSuffocating) {
        state.health = Math.max(0, state.health - 1.2); 
        logConsole("HEALTH LOSS", "空氣品質極差！健康度快速扣減！", "outbound");
    } 
    if (state.isSlouched) {
        state.health = Math.max(0, state.health - 0.4); 
        logConsole("HEALTH LOSS", "檢測到坐姿不良，健康度受到傷害。", "outbound");
    } 
    if (state.isTired && !state.isDrinking) {
        state.health = Math.max(0, state.health - 0.2); 
        logConsole("HEALTH LOSS", "久坐不動，骨骼肌肉疲勞。", "outbound");
    }
    
    updateHeartsUI();
    processThresholds(); // 再次更新判定
}, 2500);

// 發送 JSON 數據封包給伺服器
function sendPacket() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        const packet = {
            device_id: "virtual_esp32_01",
            timestamp: Math.floor(Date.now() / 1000),
            sensors: {
                weight: parseInt(state.weight),
                distance: parseInt(state.distance),
                pm25: parseInt(state.pm25)
            },
            status: {
                is_drinking: state.isDrinking,
                posture: state.isSlouched ? "slouched" : "good",
                air_quality: state.isSuffocating ? "danger" : (state.pm25 >= 35 ? "poor" : "excellent"),
                sedentary_minutes: parseInt(state.time),
                no_water_minutes: parseInt(state.noWaterTime),
                posture_stage: state.postureStage,
                dehydration_stage: state.dehydrationStage,
                sedentary_stage: state.sedentaryStage,
                air_stage: state.airStage,
                selected_pet: state.selectedPet
            }
        };
        socket.send(JSON.stringify(packet));
    }
}

// 控制台日誌顯示
function logConsole(source, text, direction) {
    const timeStr = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.classList.add("console-line");
    line.classList.add(direction);
    line.innerText = `[${timeStr}] [${source}] ${text}`;
    elConsoleLog.appendChild(line);
    elConsoleLog.scrollTop = elConsoleLog.scrollHeight;
}

// 清除日誌
elBtnClearConsole.addEventListener("click", () => {
    elConsoleLog.innerHTML = "";
});

// 蜂鳴器開關切換
elBtnToggleBuzzer.addEventListener("click", () => {
    state.buzzerMuted = !state.buzzerMuted;
    
    // 試圖喚醒 Web Audio API
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    
    if (state.buzzerMuted) {
        elBtnToggleBuzzer.className = "pixel-btn tiny secondary";
        elBtnToggleBuzzer.innerText = "🔇 BUZZER MUTED";
        logConsole("BUZZER", "已將蜂鳴器靜音", "outbound");
    } else {
        elBtnToggleBuzzer.className = "pixel-btn tiny alert-trigger-btn";
        elBtnToggleBuzzer.innerText = "🔊 BUZZER ENABLED";
        logConsole("BUZZER", "已啟用蜂鳴器聲音", "outbound");
        // 點選啟用時播放確認音 (C5)
        playBeep(523.25, 100);
    }
    
    updateBuzzer();
});

// --- 控制項事件監聽 ---
elSliderWeight.addEventListener("input", (e) => {
    state.weight = parseInt(e.target.value);
    elValWeight.innerText = `${state.weight}g`;
    processThresholds();
    sendPacket();
});

elSliderDistance.addEventListener("input", (e) => {
    state.distance = parseInt(e.target.value);
    elValDistance.innerText = `${state.distance}cm`;
    processThresholds();
    sendPacket();
});

elSliderPM25.addEventListener("input", (e) => {
    state.pm25 = parseInt(e.target.value);
    elValPM25.innerText = `${state.pm25} μg/m³`;
    processThresholds();
    sendPacket();
});

elSliderTime.addEventListener("input", (e) => {
    state.time = parseInt(e.target.value);
    elValTime.innerText = `${state.time} min`;
    processThresholds();
    sendPacket();
});

elSliderNoWater.addEventListener("input", (e) => {
    state.noWaterTime = parseInt(e.target.value);
    elValNoWater.innerText = `${state.noWaterTime} min`;
    processThresholds();
    sendPacket();
});

// --- 快捷按鈕事件監聽 ---
elBtnDrink.addEventListener("click", () => {
    const newWeight = Math.max(0, state.weight - 250);
    elSliderWeight.value = newWeight;
    state.weight = newWeight;
    elValWeight.innerText = `${newWeight}g`;
    processThresholds();
    sendPacket();
});

elBtnRefill.addEventListener("click", () => {
    elSliderWeight.value = 1000;
    state.weight = 1000;
    state.prevWeight = 1000;
    elValWeight.innerText = "1000g";
    processThresholds();
    sendPacket();
    logConsole("APP EVENT", "水杯加滿水！", "outbound");
});

elBtnDry.addEventListener("click", () => {
    elSliderNoWater.value = 90;
    state.noWaterTime = 90;
    elValNoWater.innerText = "90 min";
    processThresholds();
    sendPacket();
});

elBtnSlouch.addEventListener("click", () => {
    elSliderDistance.value = 25;
    state.distance = 25;
    elValDistance.innerText = "25cm";
    
    processThresholds();
    sendPacket();
});

elBtnGoodPosture.addEventListener("click", () => {
    elSliderDistance.value = 65;
    state.distance = 65;
    elValDistance.innerText = "65cm";
    
    processThresholds();
    sendPacket();
});

elBtnHighPM25.addEventListener("click", () => {
    elSliderPM25.value = 150;
    state.pm25 = 150;
    elValPM25.innerText = "150 μg/m³";
    
    processThresholds();
    sendPacket();
});

elBtnSedentary.addEventListener("click", () => {
    elSliderTime.value = 75;
    state.time = 75;
    elValTime.innerText = "75 min";
    
    processThresholds();
    sendPacket();
});

elBtnResetTimer.addEventListener("click", () => {
    elSliderTime.value = 0;
    state.time = 0;
    elValTime.innerText = "0 min";
    
    processThresholds();
    sendPacket();
});

// ==========================================
//   CANVAS 2D JELLY SLIME 繪圖引擎
// ==========================================

// 史萊姆核心主題色彩
const THEMES = {
    normal: {
        main: "#ff7b90",        // 粉紅
        shadow: "#e05068",
        glow: "rgba(255, 123, 144, 0.6)",
        core: "#ff4766"
    },
    water: {
        main: "#3da5ff",        // 水藍色
        shadow: "#187cdc",
        glow: "rgba(61, 165, 255, 0.7)",
        core: "#187cff"
    },
    airMild: {
        main: "#c98aff",        // 輕微毒紫色 (粉紫)
        shadow: "#9947e6",
        glow: "rgba(201, 138, 255, 0.5)",
        core: "#af57f5"
    },
    airSevere: {
        main: "#8c15d4",        // 嚴重毒紫色 (深毒紫)
        shadow: "#5c0594",
        glow: "rgba(140, 21, 212, 0.8)",
        core: "#b338ff"
    },
    postureMild: {
        main: "#ffa347",        // 輕微駝背 (亮橘色)
        shadow: "#d4751c",
        glow: "rgba(255, 163, 71, 0.5)",
        core: "#ff7c1f"
    },
    postureSevere: {
        main: "#e3401e",        // 嚴重駝背 (深紅橘色)
        shadow: "#a82208",
        glow: "rgba(227, 64, 30, 0.7)",
        core: "#ff2a00"
    },
    dehydrateMild: {
        main: "#f3c2c2",        // 輕微脫水 (淡乾癟粉紅)
        shadow: "#c88e8e",
        glow: "rgba(243, 194, 194, 0.4)",
        core: "#d57272"
    },
    dehydrateSevere: {
        main: "#c0b098",        // 嚴重脫水 (枯黃色)
        shadow: "#908068",
        glow: "rgba(192, 176, 152, 0.3)",
        core: "#8a755d"
    },
    sedentaryMild: {
        main: "#8da5bd",        // 輕微久坐 (灰藍色)
        shadow: "#61788f",
        glow: "rgba(141, 165, 189, 0.4)",
        core: "#6a829a"
    },
    sedentarySevere: {
        main: "#526273",        // 嚴重久坐 (深灰藍色)
        shadow: "#35424f",
        glow: "rgba(82, 98, 115, 0.3)",
        core: "#3f4c59"
    }
};

// 繪製史萊姆與動畫 (包裹在 try-catch 中以確保除錯安全)
function drawSlime() {
    try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 背景網格 (像素網格感)
        ctx.fillStyle = "#15151e";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = "#1b1b26";
        ctx.lineWidth = 1;
        for (let i = 0; i < canvas.width; i += 20) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, canvas.height);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(canvas.width, i);
            ctx.stroke();
        }

        // 0. 覓食 AI 導引 (尋找落下的水滴)
        let targetFood = null;
        for (const f of foods) {
            if (f.active) {
                targetFood = f;
                break;
            }
        }

        // 1. 跳動邏輯 (優先處理覓食，其次隨機跳動，異常狀態下直接留在原地)
        const canJump = (state.postureStage === 0 && state.airStage < 2 && state.sedentaryStage < 2);
        if (canJump) {
            if (slimePos.isJumping) {
                // 點擊它或久坐時，跳躍移動速度減慢
                let progressIncrement = 0.03;
                if (slimePos.pokeTimer > 0) {
                    progressIncrement = 0.018;
                } else if (state.sedentaryStage === 1) {
                    progressIncrement = 0.015;
                }
                slimePos.jumpProgress += progressIncrement;
                if (slimePos.jumpProgress >= 1) {
                    slimePos.x = slimePos.targetX;
                    slimePos.y = slimePos.targetY;
                    slimePos.isJumping = false;
                    slimePos.jumpProgress = 0;
                    slimePos.squashCount = 24; // 落地壓扁幀數從 12 增長為 24 幀
                    slimePos.jumpHeight = 60;  // 恢復預設跳躍高度
                } else {
                    slimePos.x = slimePos.startX + (slimePos.targetX - slimePos.startX) * slimePos.jumpProgress;
                    let linearY = slimePos.startY + (slimePos.targetY - slimePos.startY) * slimePos.jumpProgress;
                    let arcY = Math.sin(slimePos.jumpProgress * Math.PI) * slimePos.jumpHeight;
                    slimePos.y = linearY - arcY;
                }
            } else if (targetFood && slimePos.squashCount === 0) {
                // 水果餵食覓食 AI 跳躍
                const dxToFood = Math.abs(slimePos.x - targetFood.x);
                // 增加判定距離至 90 像素，確保身體任何部位（包含邊緣與尾巴）碰到就吃得到
                if (dxToFood < 90) {
                    // 吞食水果
                    targetFood.active = false;
                    state.isEating = true;
                    state.currentEatColor = targetFood.fruit ? targetFood.fruit.crumbColor : "#ff3b30";
                    state.isHappy = false;
                    
                    // 補充健康度
                    state.health = Math.min(10, state.health + 0.5);
                    updateHeartsUI();
                    const fruitName = targetFood.fruit ? targetFood.fruit.name : "水果";
                    logConsole("APP EVENT", `史萊姆吃掉了您投餵的${fruitName}！健康值增加！`, "outbound");
                    
                    // 噴出碎屑粒子
                    for (let i = 0; i < 12; i++) {
                        particles.push(new Particle(
                            slimePos.x + (Math.random() - 0.5) * 40,
                            slimePos.y + 10,
                            'crumb',
                            state.currentEatColor
                        ));
                    }
                    
                    if (eatTimer) clearTimeout(eatTimer);
                    eatTimer = setTimeout(() => {
                        state.isEating = false;
                        state.isHappy = true;
                        if (happyTimer) clearTimeout(happyTimer);
                        happyTimer = setTimeout(() => {
                            state.isHappy = false;
                        }, 2500);
                    }, 1200);
                } else {
                    // 朝水果方向跳躍 (適應性步長，如果小於 100px 直接跳到水果位置以防來回振盪/超調)
                    slimePos.startX = slimePos.x;
                    slimePos.startY = slimePos.y;
                    
                    const dx = targetFood.x - slimePos.x;
                    const step = Math.abs(dx) < 100 ? dx : (dx > 0 ? 100 : -100);
                    
                    slimePos.targetX = Math.max(80, Math.min(320, slimePos.x + step));
                    slimePos.targetY = 260;
                    
                    slimePos.isJumping = true;
                    slimePos.jumpProgress = 0;
                    slimePos.jumpTimer = 40; // 縮短發動間隔
                }
            } else {
                if (slimePos.squashCount > 0) {
                    slimePos.squashCount--;
                } else {
                    slimePos.jumpTimer--;
                    if (slimePos.jumpTimer <= 0) {
                        slimePos.startX = slimePos.x;
                        slimePos.startY = slimePos.y;
                        slimePos.targetX = 80 + Math.random() * 240;
                        slimePos.targetY = 220 + Math.random() * 80;
                        slimePos.isJumping = true;
                        slimePos.jumpProgress = 0;
                        // 輕微久坐時，下次跳躍時間間隔稍微加長 (300 幀)
                        slimePos.jumpTimer = (state.sedentaryStage === 1 ? 300 : 180) + Math.random() * 180;
                    }
                }
            }
        } else {
            // 異常狀態下：強制終止正在進行的跳躍，直接留在原地
            slimePos.isJumping = false;
            slimePos.jumpProgress = 0;
            slimePos.squashCount = 0;
        }

        // 2. 抖動效果 (空氣品質危害 或 游標懸停搔癢)
        let drawX = slimePos.x;
        let drawY = slimePos.y;
        if (state.airStage === 2) {
            // 嚴重窒息：劇烈抖動
            drawX += (Math.random() - 0.5) * 8;
            drawY += (Math.random() - 0.5) * 6;
        } else if (state.airStage === 1) {
            // 輕微悶熱：小幅抖動
            drawX += (Math.random() - 0.5) * 2.5;
            drawY += (Math.random() - 0.5) * 2;
        } else if (state.isMouseHovering && state.postureStage === 0 && slimePos.pokeTimer === 0) {
            // 游標搔癢：左右緩慢搖擺 (再度放慢震動速度，展現果凍彈性)
            drawX += Math.sin(animTime * 0.15) * 3.0;
        }

        // 小精靈專屬浮空微動
        if (state.selectedPet === "ghost" && !slimePos.isJumping && slimePos.squashCount === 0) {
            if (state.postureStage !== 2) {
                drawY += Math.sin(animTime * 0.06) * 8;
            }
        }

        // 3. 粒子發射器 (疊加渲染，依據狀態強度調整機率)
        if (state.isDrinking && Math.random() < 0.25) {
            particles.push(new Particle(drawX + (Math.random() - 0.5) * 20, drawY + 10, 'water'));
        }
        if (state.isEating && Math.random() < 0.3) {
            particles.push(new Particle(drawX + (Math.random() - 0.5) * 30, drawY + 10, 'crumb', state.currentEatColor));
        }
        if (state.isHappy && Math.random() < 0.12) {
            particles.push(new Particle(drawX + (Math.random() - 0.5) * 40, drawY - 30, 'heart'));
        }
        // 空氣毒霧粒子
        if (state.airStage === 2 && Math.random() < 0.25) {
            particles.push(new Particle(drawX + (Math.random() - 0.5) * 90, drawY + (Math.random() - 0.5) * 40, 'poison'));
        } else if (state.airStage === 1 && Math.random() < 0.08) {
            particles.push(new Particle(drawX + (Math.random() - 0.5) * 90, drawY + (Math.random() - 0.5) * 40, 'poison'));
        }
        // 眼淚粒子 (嚴重駝背才大哭，輕度駝背極少眼淚)
        if (state.postureStage === 2 && Math.random() < 0.2) {
            particles.push(new Particle(drawX - 20, drawY - 5, 'tear'));
            particles.push(new Particle(drawX + 20, drawY - 5, 'tear'));
        } else if (state.postureStage === 1 && Math.random() < 0.04) {
            particles.push(new Particle(drawX - 20, drawY - 5, 'tear'));
            particles.push(new Particle(drawX + 20, drawY - 5, 'tear'));
        }
        // Zzz 睡眠粒子
        if (state.sedentaryStage === 2 && Math.random() < 0.06) {
            particles.push(new Particle(drawX + 30, drawY - 45, 'sleep'));
        } else if (state.sedentaryStage === 1 && Math.random() < 0.02) {
            particles.push(new Particle(drawX + 30, drawY - 45, 'sleep'));
        }
        // 搔癢快樂愛心粒子 (方案 B)
        if (state.isMouseHovering && state.postureStage === 0 && state.airStage === 0 && slimePos.pokeTimer === 0 && Math.random() < 0.08) {
            particles.push(new Particle(drawX + (Math.random() - 0.5) * 40, drawY - 30, 'heart'));
        }

        updateAndDrawParticles();
        updateAndDrawFoods();

        // 4. 顏色主題與形變疊加
        let theme = THEMES.normal;
        if (state.airStage === 2) {
            theme = THEMES.airSevere;
        } else if (state.dehydrationStage === 2) {
            theme = THEMES.dehydrateSevere;
        } else if (state.postureStage === 2) {
            theme = THEMES.postureSevere;
        } else if (state.sedentaryStage === 2) {
            theme = THEMES.sedentarySevere;
        } else if (state.airStage === 1) {
            theme = THEMES.airMild;
        } else if (state.dehydrationStage === 1) {
            theme = THEMES.dehydrateMild;
        } else if (state.postureStage === 1) {
            theme = THEMES.postureMild;
        } else if (state.sedentaryStage === 1) {
            theme = THEMES.sedentaryMild;
        } else if (state.isDrinking) {
            theme = THEMES.water;
        } else if (state.isHappy) {
            theme = THEMES.normal;
        }

        // 當處於正常或開心狀態時，針對不同角色覆蓋專屬的預設顏色主題
        if (state.airStage === 0 && state.dehydrationStage === 0 && state.postureStage === 0 && state.sedentaryStage === 0 && !state.isDrinking) {
            if (state.selectedPet === "cat") {
                theme = {
                    main: "#fdfaf2",
                    shadow: "#e8dfce",
                    glow: "rgba(253, 250, 242, 0.6)",
                    core: "#ffccd5"
                };
            } else if (state.selectedPet === "ghost") {
                theme = {
                    main: "rgba(240, 245, 255, 0.85)",
                    shadow: "rgba(195, 205, 230, 0.9)",
                    glow: "rgba(255, 255, 255, 0.4)",
                    core: "rgba(255, 182, 193, 0.5)"
                };
            } else if (state.selectedPet === "chick") {
                theme = {
                    main: "#ffe135",
                    shadow: "#e0bf16",
                    glow: "rgba(255, 225, 53, 0.6)",
                    core: "#ff9500"
                };
            } else if (state.selectedPet === "bubble") {
                theme = {
                    main: "#3c2f2f",
                    shadow: "#211818",
                    glow: "rgba(60, 47, 47, 0.6)",
                    core: "#ff7b90"
                };
            }
        }

        // 脫水縮小比例：Stage 0 = 1.0, Stage 1 = 0.85, Stage 2 = 0.70
        let baseScale = 1.0;
        if (state.dehydrationStage === 2) {
            baseScale = 0.7;
        } else if (state.dehydrationStage === 1) {
            baseScale = 0.85;
        }

        let scaleX = 1.0;
        let scaleY = 1.0;
        
        // 駝背壓扁形變：Stage 0 = 1.0, Stage 1 = Y 0.8/X 1.2, Stage 2 = Y 0.58/X 1.45
        let slouchX = 1.0;
        let slouchY = 1.0;
        if (state.postureStage === 2) {
            slouchY = 0.58;
            slouchX = 1.45;
        } else if (state.postureStage === 1) {
            slouchY = 0.80;
            slouchX = 1.20;
        }

        let jumpX = 1.0;
        let jumpY = 1.0;
        if (slimePos.isJumping) {
            if (slimePos.jumpProgress < 0.5) {
                jumpY = 1.22;
                jumpX = 0.82;
            } else {
                jumpY = 0.95;
                jumpX = 1.05;
            }
        } else if (slimePos.squashCount > 0) {
            jumpY = 0.72 + (24 - slimePos.squashCount) * 0.0116;
            jumpX = 1.28 - (24 - slimePos.squashCount) * 0.0116;
        }

        // 戳戳形變 (方案 A)：壓扁 X=1.3, Y=0.5
        let pokeX = 1.0;
        let pokeY = 1.0;
        if (slimePos.pokeTimer > 0) {
            pokeY = 0.5;
            pokeX = 1.3;
            slimePos.pokeTimer--;
        }

        // 呼吸起伏動畫 (在地面且非駝背、非戳戳時)
        let breathX = 1.0;
        let breathY = 1.0;
        if (!slimePos.isJumping && slimePos.squashCount === 0 && state.postureStage === 0 && slimePos.pokeTimer === 0 && !state.isEating) {
            // 久坐時呼吸也變慢
            let breathSpeed = 0.05;
            if (state.sedentaryStage === 1) breathSpeed = 0.025;
            else if (state.sedentaryStage === 2) breathSpeed = 0.012; // 熟睡呼吸極慢
            
            breathY = 1.0 + Math.sin(animTime * breathSpeed) * 0.03;
            breathX = 1.0 / breathY;
        }

        scaleX = baseScale * slouchX * jumpX * breathX * pokeX;
        scaleY = baseScale * slouchY * jumpY * breathY * pokeY;

        // --- 角色本體與結構繪製 ---
        ctx.save();
        ctx.translate(drawX, drawY);
        ctx.scale(scaleX, scaleY);

        ctx.shadowBlur = state.airStage === 2 ? 30 : (state.postureStage === 2 ? 15 : 20);
        ctx.shadowColor = theme.glow;
        
        ctx.fillStyle = theme.main;
        ctx.strokeStyle = theme.shadow;
        ctx.lineWidth = 6;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        // 1. 繪製貓耳與貓尾 (麻吉貓專屬，耳朵在外側以便先畫耳朵)
        if (state.selectedPet === "cat") {
            // 左貓耳
            ctx.fillStyle = theme.main;
            ctx.strokeStyle = theme.shadow;
            ctx.lineWidth = 5;
            ctx.beginPath();
            if (state.postureStage > 0) {
                // 垂耳
                ctx.moveTo(-52, -22);
                ctx.quadraticCurveTo(-52, -35, -35, -25);
                ctx.lineTo(-24, -28);
            } else {
                ctx.moveTo(-52, -25);
                ctx.lineTo(-38, -48);
                ctx.lineTo(-22, -32);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
            // 左粉紅內耳
            ctx.fillStyle = "rgba(255, 180, 190, 0.7)";
            ctx.beginPath();
            if (state.postureStage > 0) {
                ctx.moveTo(-47, -23);
                ctx.quadraticCurveTo(-47, -30, -37, -24);
                ctx.lineTo(-27, -27);
            } else {
                ctx.moveTo(-47, -26);
                ctx.lineTo(-38, -42);
                ctx.lineTo(-26, -32);
            }
            ctx.closePath();
            ctx.fill();

            // 右貓耳
            ctx.fillStyle = theme.main;
            ctx.strokeStyle = theme.shadow;
            ctx.lineWidth = 5;
            ctx.beginPath();
            if (state.postureStage > 0) {
                // 垂耳
                ctx.moveTo(52, -22);
                ctx.quadraticCurveTo(52, -35, 35, -25);
                ctx.lineTo(24, -28);
            } else {
                ctx.moveTo(52, -25);
                ctx.lineTo(38, -48);
                ctx.lineTo(22, -32);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
            // 右粉紅內耳
            ctx.fillStyle = "rgba(255, 180, 190, 0.7)";
            ctx.beginPath();
            if (state.postureStage > 0) {
                ctx.moveTo(47, -23);
                ctx.quadraticCurveTo(47, -30, 37, -24);
                ctx.lineTo(27, -27);
            } else {
                ctx.moveTo(47, -26);
                ctx.lineTo(38, -42);
                ctx.lineTo(26, -32);
            }
            ctx.closePath();
            ctx.fill();

            // 貓尾巴
            ctx.strokeStyle = theme.shadow;
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(50, 25);
            if (state.sedentaryStage === 2) {
                ctx.bezierCurveTo(70, 25, 60, -5, 45, 5);
            } else {
                ctx.bezierCurveTo(75, 25, 70, -10, 80, -5);
            }
            ctx.stroke();
            
            // 貓鬍鬚
            ctx.strokeStyle = "#1e1b29";
            ctx.lineWidth = 2.5;
            let whiskerShake = (state.airStage > 0) ? Math.sin(animTime * 0.5) * 3 : 0;
            // 左鬍鬚
            ctx.beginPath();
            ctx.moveTo(-35, 8); ctx.lineTo(-50, 6 + whiskerShake);
            ctx.moveTo(-35, 12); ctx.lineTo(-48, 14 - whiskerShake);
            // 右鬍鬚
            ctx.moveTo(35, 8); ctx.lineTo(50, 6 - whiskerShake);
            ctx.moveTo(35, 12); ctx.lineTo(48, 14 + whiskerShake);
            ctx.stroke();
        }

        // 2. 小精靈的飄浮小手
        if (state.selectedPet === "ghost") {
            ctx.fillStyle = theme.main;
            ctx.strokeStyle = theme.shadow;
            ctx.lineWidth = 5;
            
            // 左手
            ctx.beginPath();
            ctx.moveTo(-45, -5);
            if (state.postureStage > 0) {
                ctx.quadraticCurveTo(-60, 10, -50, 20);
            } else if (state.isHappy) {
                ctx.quadraticCurveTo(-65, -15, -50, -25);
            } else {
                ctx.quadraticCurveTo(-65, -5, -55, 5);
            }
            ctx.stroke();
            
            // 右手
            ctx.beginPath();
            ctx.moveTo(45, -5);
            if (state.postureStage > 0) {
                ctx.quadraticCurveTo(60, 10, 50, 20);
            } else if (state.isHappy) {
                ctx.quadraticCurveTo(65, -15, 50, -25);
            } else {
                ctx.quadraticCurveTo(65, -5, 55, 5);
            }
            ctx.stroke();
        }

        // 3. 小黃雞的腳丫
        if (state.selectedPet === "chick" && !slimePos.isJumping && state.sedentaryStage !== 2) {
            ctx.strokeStyle = "#ffa347";
            ctx.lineWidth = 4;
            // 左腳
            ctx.beginPath();
            ctx.moveTo(-20, 50); ctx.lineTo(-20, 60);
            ctx.moveTo(-20, 60); ctx.lineTo(-26, 62);
            ctx.moveTo(-20, 60); ctx.lineTo(-14, 62);
            ctx.stroke();
            // 右腳
            ctx.beginPath();
            ctx.moveTo(20, 50); ctx.lineTo(20, 60);
            ctx.moveTo(20, 60); ctx.lineTo(14, 62);
            ctx.moveTo(20, 60); ctx.lineTo(26, 62);
            ctx.stroke();
        }

        // 4. 繪製主身體
        ctx.fillStyle = theme.main;
        ctx.strokeStyle = theme.shadow;
        ctx.lineWidth = 6;
        
        if (state.selectedPet === "slime" || state.selectedPet === "cat") {
            // 史萊姆 / 貓咪 身體
            ctx.beginPath();
            ctx.moveTo(-60, 20);
            ctx.bezierCurveTo(-60, -50, 60, -50, 60, 20);
            ctx.bezierCurveTo(60, 45, -60, 45, -60, 20);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } 
        else if (state.selectedPet === "ghost") {
            // 小精靈 身體
            ctx.beginPath();
            ctx.moveTo(-55, 15);
            ctx.bezierCurveTo(-55, -55, 55, -55, 55, 15);
            ctx.quadraticCurveTo(55, 25, 55, 25);
            // 裙擺波浪
            let waveHeight = (state.postureStage === 2) ? 2 : 12;
            let waveY = 25 + Math.sin(animTime * 0.1) * (state.postureStage === 2 ? 0 : 3);
            ctx.quadraticCurveTo(36, waveY + waveHeight, 18, waveY);
            ctx.quadraticCurveTo(0, waveY + waveHeight, -18, waveY);
            ctx.quadraticCurveTo(-36, waveY + waveHeight, -55, waveY);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } 
        else if (state.selectedPet === "chick") {
            // 小黃雞 圓滾滾身體
            ctx.beginPath();
            ctx.arc(0, 5, 50, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // 繪製小雞翅膀
            let wingAngle = 0;
            if (slimePos.isJumping) {
                wingAngle = -Math.sin(animTime * 0.3) * 0.5;
            } else if (state.postureStage > 0) {
                wingAngle = 0.4;
            }
            
            // 左翅膀
            ctx.save();
            ctx.translate(-42, 5);
            ctx.rotate(wingAngle);
            ctx.beginPath();
            ctx.ellipse(-10, 0, 14, 8, 0, 0, Math.PI * 2);
            ctx.fillStyle = theme.main;
            ctx.strokeStyle = theme.shadow;
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 右翅膀
            ctx.save();
            ctx.translate(42, 5);
            ctx.rotate(-wingAngle);
            ctx.beginPath();
            ctx.ellipse(10, 0, 14, 8, 0, 0, Math.PI * 2);
            ctx.fillStyle = theme.main;
            ctx.strokeStyle = theme.shadow;
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        } 
        else if (state.selectedPet === "bubble") {
            // 黑糖珍珠 圓球身體
            ctx.beginPath();
            ctx.arc(0, 5, 52, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        ctx.shadowBlur = 0; // 關閉發光效果

        // 5. 脫水龜裂線
        if (state.selectedPet !== "ghost" && state.selectedPet !== "bubble") {
            if (state.dehydrationStage === 2) {
                ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(-45, -10); ctx.lineTo(-35, -5); ctx.lineTo(-30, -12);
                ctx.moveTo(35, -15); ctx.lineTo(40, -8); ctx.lineTo(45, -12);
                ctx.moveTo(-15, -30); ctx.lineTo(-10, -25);
                ctx.stroke();
            } else if (state.dehydrationStage === 1) {
                ctx.strokeStyle = "rgba(0, 0, 0, 0.18)";
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(-45, -10); ctx.lineTo(-35, -5);
                ctx.moveTo(35, -15); ctx.lineTo(40, -8);
                ctx.stroke();
            }
        }

        // 6. 毒素斑點 (二氧化碳過高)
        if (state.selectedPet !== "ghost" && state.selectedPet !== "bubble") {
            if (state.airStage === 2) {
                ctx.fillStyle = "#3be255";
                ctx.beginPath();
                ctx.arc(-35, -25, 4, 0, Math.PI * 2);
                ctx.arc(35, -20, 5, 0, Math.PI * 2);
                ctx.arc(45, 5, 3, 0, Math.PI * 2);
                ctx.arc(-42, 10, 3, 0, Math.PI * 2);
                ctx.fill();
            } else if (state.airStage === 1) {
                ctx.fillStyle = "#5ae270";
                ctx.beginPath();
                ctx.arc(-35, -25, 3, 0, Math.PI * 2);
                ctx.arc(35, -20, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 7. 內層核心
        if (state.selectedPet === "slime" || state.selectedPet === "cat") {
            ctx.fillStyle = theme.core;
            ctx.beginPath();
            ctx.moveTo(-25, 10);
            ctx.bezierCurveTo(-25, -20, 25, -20, 25, 10);
            ctx.bezierCurveTo(25, 22, -25, 22, -25, 10);
            ctx.closePath();
            ctx.fill();
        }

        // 8. 亮部高光
        if (state.selectedPet === "bubble") {
            // 珍珠高光 (3D立體球體質感)
            if (state.dehydrationStage < 2) {
                ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
                ctx.beginPath();
                ctx.ellipse(-20, -20, 11, 5, -Math.PI / 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
                ctx.beginPath();
                ctx.ellipse(20, 20, 7, 3, -Math.PI / 4, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            // 普通的高光橢圓
            ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
            ctx.beginPath();
            ctx.ellipse(-28, -12, 10, 5, -Math.PI / 4, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // 9. 腮紅
        ctx.fillStyle = theme.blush || "rgba(255, 50, 80, 0.4)";
        ctx.beginPath();
        ctx.ellipse(-30, 8, 8, 4, 0, 0, Math.PI * 2);
        ctx.ellipse(30, 8, 8, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // 10. 表情與眼睛
        ctx.fillStyle = "#1e1b29";
        const leftEyeX = -20;
        const rightEyeX = 20;
        const eyeY = 0;

        let eyeType = "normal";
        if (state.airStage === 2) {
            eyeType = "dead";
        } else if (state.dehydrationStage === 2) {
            eyeType = "sad";
        } else if (state.postureStage === 2) {
            eyeType = "cry";
        } else if (state.sedentaryStage === 2) {
            eyeType = "sleep";
        } else if (slimePos.pokeTimer > 0) {
            eyeType = "shocked"; // 圓形驚訝眼 (方案 A)
        } else if (state.airStage === 1) {
            eyeType = "dizzy";
        } else if (state.dehydrationStage === 1) {
            eyeType = "sad";
        } else if (state.postureStage === 1) {
            eyeType = "sad";
        } else if (state.isMouseHovering) {
            eyeType = "happy"; // 懸停瞇眼笑 (方案 B)
        } else if (state.sedentaryStage === 1) {
            eyeType = "tired";
        } else if (state.isHappy) {
            eyeType = "happy";
        }

        let isBlinking = (animTime % 180 > 172) && (eyeType === "normal");

        if (eyeType === "happy") {
            ctx.strokeStyle = "#1e1b29";
            ctx.lineWidth = 4;
            ctx.lineCap = "round";
            ctx.beginPath(); ctx.arc(leftEyeX, eyeY + 4, 8, Math.PI, 0); ctx.stroke();
            ctx.beginPath(); ctx.arc(rightEyeX, eyeY + 4, 8, Math.PI, 0); ctx.stroke();
        } 
        else if (eyeType === "sad" || eyeType === "cry") {
            ctx.strokeStyle = "#1e1b29";
            ctx.lineWidth = 4;
            ctx.lineCap = "round";
            ctx.beginPath(); ctx.moveTo(leftEyeX - 6, eyeY - 4); ctx.lineTo(leftEyeX, eyeY); ctx.lineTo(leftEyeX - 6, eyeY + 4); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(rightEyeX + 6, eyeY - 4); ctx.lineTo(rightEyeX, eyeY); ctx.lineTo(rightEyeX + 6, eyeY + 4); ctx.stroke();
        } 
        else if (eyeType === "dead") {
            ctx.strokeStyle = "#1e1b29";
            ctx.lineWidth = 4;
            ctx.lineCap = "round";
            ctx.beginPath(); ctx.moveTo(leftEyeX - 5, eyeY - 5); ctx.lineTo(leftEyeX + 5, eyeY + 5); ctx.moveTo(leftEyeX + 5, eyeY - 5); ctx.lineTo(leftEyeX - 5, eyeY + 5); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(rightEyeX - 5, eyeY - 5); ctx.lineTo(rightEyeX + 5, eyeY + 5); ctx.moveTo(rightEyeX + 5, eyeY - 5); ctx.lineTo(rightEyeX - 5, eyeY + 5); ctx.stroke();
        } 
        else if (eyeType === "dizzy") {
            ctx.strokeStyle = "#1e1b29";
            ctx.lineWidth = 4;
            ctx.lineCap = "round";
            ctx.beginPath(); ctx.moveTo(leftEyeX - 4, eyeY - 3); ctx.lineTo(leftEyeX + 4, eyeY + 3); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(rightEyeX - 4, eyeY + 3); ctx.lineTo(rightEyeX + 4, eyeY - 3); ctx.stroke();
        }
        else if (eyeType === "sleep") {
            ctx.strokeStyle = "#1e1b29";
            ctx.lineWidth = 4;
            ctx.lineCap = "round";
            ctx.beginPath(); ctx.moveTo(leftEyeX - 6, eyeY + 2); ctx.lineTo(leftEyeX + 6, eyeY + 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(rightEyeX - 6, eyeY + 2); ctx.lineTo(rightEyeX + 6, eyeY + 2); ctx.stroke();
        } 
        else if (eyeType === "shocked") {
            // 圓形驚訝眼
            ctx.strokeStyle = "#1e1b29";
            ctx.lineWidth = 3.5;
            ctx.beginPath(); ctx.arc(leftEyeX, eyeY, 7, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(rightEyeX, eyeY, 7, 0, Math.PI * 2); ctx.stroke();
            
            ctx.fillStyle = "#1e1b29";
            ctx.beginPath();
            ctx.arc(leftEyeX, eyeY, 3, 0, Math.PI * 2);
            ctx.arc(rightEyeX, eyeY, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        else if (eyeType === "tired") {
            // 半閉眼 (眼瞼覆蓋上部)
            ctx.beginPath();
            ctx.arc(leftEyeX, eyeY, 6, 0, Math.PI * 2);
            ctx.arc(rightEyeX, eyeY, 6, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = theme.shadow;
            ctx.fillRect(leftEyeX - 7, eyeY - 7, 14, 6);
            ctx.fillRect(rightEyeX - 7, eyeY - 7, 14, 6);
            
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(leftEyeX - 2, eyeY + 1, 1.5, 0, Math.PI * 2);
            ctx.arc(rightEyeX - 2, eyeY + 1, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
        else {
            if (isBlinking) {
                ctx.strokeStyle = "#1e1b29";
                ctx.lineWidth = 4;
                ctx.lineCap = "round";
                ctx.beginPath(); ctx.moveTo(leftEyeX - 5, eyeY); ctx.lineTo(leftEyeX + 5, eyeY); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(rightEyeX - 5, eyeY); ctx.lineTo(rightEyeX + 5, eyeY); ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(leftEyeX, eyeY, 6, 0, Math.PI * 2);
                ctx.arc(rightEyeX, eyeY, 6, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.fillStyle = "#ffffff";
                ctx.beginPath();
                ctx.arc(leftEyeX - 2, eyeY - 2, 2, 0, Math.PI * 2);
                ctx.arc(rightEyeX - 2, eyeY - 2, 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 11. 嘴巴 / 喙嘴 (喙嘴為小黃雞專屬，其餘為一般口型)
        ctx.fillStyle = "#1e1b29";
        ctx.strokeStyle = "#1e1b29";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";

        if (state.selectedPet === "chick") {
            // 繪製小雞喙嘴 (吃水果時開合)
            let beakOpen = 0;
            if (state.isEating) {
                beakOpen = Math.abs(Math.sin(animTime * 0.25)) * 6;
            }
            ctx.fillStyle = "#ffa347";
            ctx.strokeStyle = "#e87c1e";
            ctx.lineWidth = 2.5;
            
            // 上喙
            ctx.beginPath();
            ctx.moveTo(-10, 6 - beakOpen);
            ctx.lineTo(0, 1 - beakOpen);
            ctx.lineTo(10, 6 - beakOpen);
            ctx.lineTo(0, 9);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
            // 下喙
            ctx.beginPath();
            ctx.moveTo(-8, 7 + beakOpen);
            ctx.lineTo(0, 13 + beakOpen);
            ctx.lineTo(8, 7 + beakOpen);
            ctx.lineTo(0, 9);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } 
        else {
            if (slimePos.pokeTimer > 0) {
                // 戳戳驚訝口
                ctx.beginPath(); ctx.arc(0, 12, 8, 0, Math.PI * 2); ctx.fill();
            }
            else if (state.isEating) {
                let chewScaleY = 1 + Math.sin(animTime * 0.25) * 0.3;
                let chewScaleX = 1 - Math.sin(animTime * 0.25) * 0.15;
                ctx.beginPath();
                ctx.ellipse(0, 10, 7 * chewScaleX, 5 * chewScaleY, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            else if (state.isDrinking) {
                let drinkScale = 1 + Math.sin(animTime * 0.18) * 0.25;
                ctx.beginPath();
                ctx.arc(0, 10, 8 * drinkScale, 0, Math.PI * 2);
                ctx.fill();
            }
            else if (state.airStage === 2) {
                ctx.beginPath(); ctx.arc(0, 12, 7, 0, Math.PI * 2); ctx.fill();
            } 
            else if (state.airStage === 1) {
                // 悶熱：波浪嘴
                ctx.beginPath();
                ctx.moveTo(-6, 10);
                ctx.lineTo(-2, 12);
                ctx.lineTo(2, 8);
                ctx.lineTo(6, 10);
                ctx.stroke();
            }
            else if (state.isHappy) {
                ctx.beginPath(); ctx.arc(0, 8, 7, 0, Math.PI); ctx.fill();
            }
            else if (state.dehydrationStage === 2 || state.postureStage === 2) {
                ctx.beginPath(); ctx.arc(0, 15, 6, Math.PI, 0); ctx.stroke();
            } 
            else if (state.dehydrationStage === 1 || state.postureStage === 1) {
                ctx.beginPath(); ctx.arc(0, 13, 4, Math.PI, 0); ctx.stroke();
            }
            else if (state.sedentaryStage === 2) {
                let sleepMouthSize = 2 + Math.abs(Math.sin(animTime * 0.02)) * 3;
                ctx.beginPath(); ctx.arc(0, 12, sleepMouthSize, 0, Math.PI * 2); ctx.fill();
            } 
            else if (state.sedentaryStage === 1) {
                ctx.beginPath(); ctx.moveTo(-4, 10); ctx.lineTo(4, 10); ctx.stroke();
            } 
            else {
                ctx.beginPath(); ctx.arc(0, 8, 3, 0, Math.PI); ctx.fill();
            }
        }

        // 12. 頭頂開花
        if (state.isHappy) {
            ctx.save();
            ctx.translate(0, -42);
            ctx.strokeStyle = "#5c8e32";
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(0, 0); ctx.stroke();
            
            ctx.fillStyle = "#ff2e4d";
            ctx.beginPath();
            ctx.arc(-4, -4, 4, 0, Math.PI * 2);
            ctx.arc(4, -4, 4, 0, Math.PI * 2);
            ctx.arc(-4, 2, 4, 0, Math.PI * 2);
            ctx.arc(4, 2, 4, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = "#ffdd00";
            ctx.beginPath(); ctx.arc(0, -1, 3.5, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }

        ctx.restore();
        animTime++;
    } catch (e) {
        // 如果渲染出錯，在畫面上描繪紅色錯誤訊息
        console.error("Slime Render Error: ", e);
        ctx.fillStyle = "#ff5555";
        ctx.font = "bold 12px Arial";
        ctx.fillText("Render Error: " + e.message, 10, 30);
    }
}

// 動畫循環
function animate() {
    drawSlime();
    animationFrameId = requestAnimationFrame(animate);
}

// --- 滑鼠互動輔助函數 ---
function checkMouseHover(mouseX, mouseY) {
    const cx = slimePos.x;
    const cy = slimePos.y - 10;
    const a = 60; // 水平半軸
    const b = 45; // 垂直半軸
    const dx = mouseX - cx;
    const dy = mouseY - cy;
    return (dx * dx) / (a * a) + (dy * dy) / (b * b) <= 1;
}

// --- 滑鼠互動事件監聽 ---
canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;
    
    const hovering = checkMouseHover(mouseX, mouseY);
    state.isMouseHovering = hovering;
    canvas.style.cursor = hovering ? "pointer" : "default";
});

canvas.addEventListener("mouseleave", () => {
    state.isMouseHovering = false;
    canvas.style.cursor = "default";
});

canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;
    
    const clickedSlime = checkMouseHover(mouseX, mouseY);
    
    if (clickedSlime) {
        // 點擊史萊姆本體：戳一下 (Poke)
        if (state.airStage < 2 && state.postureStage === 0) {
            slimePos.pokeTimer = 45; // 延長戳戳驚訝時間至 45 幀，配合放慢的跳躍
            
            // 彈跳起飛
            if (!slimePos.isJumping && slimePos.squashCount === 0) {
                slimePos.startX = slimePos.x;
                slimePos.startY = slimePos.y;
                slimePos.targetX = slimePos.x;
                slimePos.targetY = slimePos.y;
                slimePos.isJumping = true;
                slimePos.jumpProgress = 0;
                slimePos.jumpHeight = 90; // 高跳
            }
            
            // 根據選取角色決定噴出的粒子類型與顏色
            let pokeParticleType = 'water';
            let pokeParticleColor = null;
            if (state.selectedPet === 'cat') {
                pokeParticleType = 'crumb';
                pokeParticleColor = '#ffccd5';
            } else if (state.selectedPet === 'chick') {
                pokeParticleType = 'crumb';
                pokeParticleColor = '#ffe135';
            } else if (state.selectedPet === 'bubble') {
                pokeParticleType = 'crumb';
                pokeParticleColor = '#3c2f2f';
            }

            // 噴射微量果凍/碎屑粒子
            for (let i = 0; i < 8; i++) {
                particles.push(new Particle(
                    slimePos.x + (Math.random() - 0.5) * 40,
                    slimePos.y - 10,
                    pokeParticleType,
                    pokeParticleColor
                ));
            }
            
            logConsole("APP EVENT", "你戳了一下史萊姆！它驚訝地跳了起來！", "outbound");
        }
    } else {
        // 點擊空白處：投餵隨機水果
        if (foods.length < 3) {
            const randomFruit = FRUITS[Math.floor(Math.random() * FRUITS.length)];
            foods.push({
                x: mouseX,
                y: mouseY,
                vy: 0,
                active: true,
                fruit: randomFruit
            });
            logConsole("APP EVENT", `投餵了一個${randomFruit.name}，史萊姆正朝水果方向移動！`, "outbound");
        }
    }
});

// --- 初始化流程 ---
window.addEventListener("load", () => {
    updateHeartsUI();
    processThresholds();
    connectWebSocket();
    animate();

    // 綁定角色選擇按鈕點擊事件
    document.querySelectorAll(".pet-selector .pixel-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            document.querySelectorAll(".pet-selector .pixel-btn").forEach(b => b.classList.remove("active"));
            e.currentTarget.classList.add("active");
            state.selectedPet = e.currentTarget.getAttribute("data-pet");
            
            // 同步變更面板上的標題
            const titles = {
                slime: "JELLY SLIME",
                cat: "MOCHI CAT",
                ghost: "MINI GHOST",
                chick: "PIPI CHICK",
                bubble: "TAPIOCA BUBBLE"
            };
            const currentTitle = titles[state.selectedPet] || "JELLY SLIME";
            document.querySelector(".pet-panel .section-title").innerHTML = 
                `<span class="brick redstone"></span> ${currentTitle}`;
            
            logConsole("APP EVENT", `切換角色為：${e.currentTarget.innerText}`, "outbound");
            sendPacket();
        });
    });
});
