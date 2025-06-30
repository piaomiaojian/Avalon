// ==================== UI控制層 (UI Controller) ====================
// 版本: 1.0.26
// 最後更新: 2024-12-19
// 修復內容: WebRTC連接問題，改進peer配置和錯誤處理

class UIController {
    constructor(game, transport) {
        this.game = game;
        this.transport = transport;
        this.qrcode = null;
        this.codeReader = null;
        this.myRole = null;
        this.isScanning = false;
        this.hostOfferSignal = null;
        this.hostPeer = null;
        
        // 檢查ZXing庫是否載入
        if (typeof ZXing === 'undefined') {
            console.error('ZXing 庫未載入！');
        } else {
            console.log('ZXing 庫載入成功');
        }
        
        // 檢查SimplePeer庫是否載入
        if (typeof SimplePeer === 'undefined') {
            console.error('SimplePeer 庫未載入！這會導致加入房間功能無法使用');
            this.showSimplePeerError();
        } else {
            console.log('SimplePeer 庫載入成功');
        }
        
        this.setupEventListeners();
        this.setupQRCode();
        this.setupGameEventHandlers();
        this.setupErrorHandling();
    }

    setupEventListeners() {
        // 主選單按鈕
        document.getElementById('btnHost').addEventListener('click', () => this.createRoom());
        document.getElementById('btnJoin').addEventListener('click', () => this.joinRoom());

        // 投票按鈕
        document.getElementById('btnVoteSuccess').addEventListener('click', () => this.vote(true));
        document.getElementById('btnVoteFail').addEventListener('click', () => this.vote(false));

        // 手動加入按鈕（只綁定一次）
        const btnManualJoin = document.getElementById('btnManualJoin');
        const manualQrInput = document.getElementById('manualQrInput');
        if (btnManualJoin && manualQrInput) {
            btnManualJoin.addEventListener('click', () => {
                const input = manualQrInput.value.trim();
                if (!input) {
                    this.showScanError('請貼上QR碼內容', { message: '請貼上QR碼內容' });
                    return;
                }
                this.handleManualJoin(input);
            });
            manualQrInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    btnManualJoin.click();
                }
            });
        }

        // 返回QR碼按鈕
        const btnBackToQR = document.getElementById('btnBackToQR');
        if (btnBackToQR) {
            btnBackToQR.addEventListener('click', () => {
                this.stopScanning();
                this.hideElement('scanContainer');
                // 根據身份決定返回路徑
                if (this.transport.isHostPlayer()) {
                    // 房主：返回QR碼區域
                    this.showElement('qrContainer');
                } else {
                    // 加入者：返回主選單
                    this.showElement('mainMenu');
                }
            });
        }

        // 返回房間按鈕
        const btnBackToRoom = document.getElementById('btnBackToRoom');
        if (btnBackToRoom) {
            btnBackToRoom.addEventListener('click', () => {
                this.hideElement('qrContainer');
                this.showRoomArea();
            });
        }

        // 房間區域按鈕
        const btnAddPlayer = document.getElementById('btnAddPlayer');
        if (btnAddPlayer) {
            btnAddPlayer.addEventListener('click', () => this.startHostScanning());
        }

        const btnStartGame = document.getElementById('btnStartGame');
        if (btnStartGame) {
            btnStartGame.addEventListener('click', () => this.startGame());
        }

        // 遊戲操作區域按鈕
        const btnViewGame = document.getElementById('btnViewGame');
        if (btnViewGame) {
            btnViewGame.addEventListener('click', () => this.showGameView());
        }

        // 遊戲查看區域按鈕
        const btnBackToGame = document.getElementById('btnBackToGame');
        if (btnBackToGame) {
            btnBackToGame.addEventListener('click', () => this.showGameOperation());
        }

        // 房間聊天
        const btnSendMessage = document.getElementById('btnSendMessage');
        const roomChatInput = document.getElementById('roomChatInput');
        if (btnSendMessage && roomChatInput) {
            btnSendMessage.addEventListener('click', () => this.sendRoomMessage());
            roomChatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.sendRoomMessage();
                }
            });
        }

        // 掃描按鈕（僅房主可見）
        const btnScan = document.getElementById('btnScan');
        if (btnScan) {
            btnScan.addEventListener('click', () => {
                this.hideElement('qrContainer');
                this.showElement('scanContainer');
                this.startScanning();
            });
        }
    }

    setupQRCode() {
        const qrElement = document.getElementById('qr');
        if (!qrElement) {
            console.error('QR碼元素不存在，無法初始化QRCode');
            return;
        }
        
        this.qrcode = new QRCode("qr", {
            width: 240,
            height: 240,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.L
        });
    }

    setupGameEventHandlers() {
        // 遊戲事件處理
        this.game.onGameEvent('playerJoined', (data) => {
            this.addChatMessage(`${data.player.name} 加入了遊戲`);
            this.addRoomMessage(`${data.player.name} 加入了房間`);
            this.updateRoomStatus();
            this.updateRoomPlayerList();
        });

        this.game.onGameEvent('rolesAssigned', (data) => {
            this.addChatMessage('角色分配完成！');
            this.addRoomMessage('遊戲開始！角色分配完成');
            this.showGameOperationArea();
        });

        this.game.onGameEvent('missionStarted', (data) => {
            this.addChatMessage(`第${data.missionNumber}輪任務開始，需要${data.missionSize}名成員`);
            this.updateGamePhase();
        });

        this.game.onGameEvent('votingStarted', (data) => {
            this.addChatMessage('開始投票！');
            this.updateGamePhase();
        });

        this.game.onGameEvent('voteReceived', (data) => {
            this.addChatMessage(`收到投票: ${data.vote.vote ? '成功' : '失敗'}`);
        });

        this.game.onGameEvent('missionCompleted', (data) => {
            this.addChatMessage(`第${data.missionNumber}輪任務: ${data.success ? '成功' : '失敗'}`);
            this.updateGamePhase();
        });

        this.game.onGameEvent('gameEnded', (data) => {
            this.addChatMessage(`遊戲結束！${data.winner === 'good' ? '好人' : '壞人'}獲勝！`);
            this.addRoomMessage(`遊戲結束！${data.winner === 'good' ? '好人' : '壞人'}獲勝！`);
        });

        this.game.onGameEvent('assassinationCompleted', (data) => {
            const result = data.assassinWins ? '刺客成功刺殺梅林！壞人最終獲勝！' : '刺客刺殺失敗！好人最終獲勝！';
            this.addChatMessage(result);
            this.addRoomMessage(result);
        });
    }

    // 創建房間
    async createRoom() {
        this.transport.setHostStatus(true);
        this.hideElement('mainMenu');
        this.showRoomArea();
        
        try {
            // 檢查SimplePeer是否可用
            if (typeof SimplePeer === 'undefined') {
                throw new Error('SimplePeer 庫未載入，請檢查網路連接');
            }
            
            // 房主創建一個peer並保存，用於後續處理answer
            console.log('房主創建WebRTC peer...');
            this.hostPeer = new SimplePeer({ 
                initiator: true, 
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' },
                        { urls: 'stun:stun3.l.google.com:19302' },
                        { urls: 'stun:stun4.l.google.com:19302' }
                    ]
                }
            });
            
            console.log('房主peer創建完成，初始信令狀態:', this.hostPeer.signalingState);
            this.setupPeer(this.hostPeer);
            
            this.hostPeer.on('signal', (data) => {
                // 房主發送offer信號
                if (data.type === 'offer') {
                    console.log('房主生成offer信號');
                    console.log('當前信令狀態:', this.hostPeer.signalingState);
                    console.log('當前連接狀態:', this.hostPeer.connectionState);
                    
                    const compressed = LZString.compressToBase64(JSON.stringify(data));
                    
                    // 檢查QRCode是否可用
                    if (this.qrcode) {
                        this.qrcode.makeCode(compressed);
                    }
                    
                    // 檢查QR碼文字元素是否存在
                    const qrTextElement = document.getElementById('qrText');
                    if (qrTextElement) {
                        qrTextElement.textContent = compressed;
                    }
                    
                    const qrTitleElement = document.getElementById('qrTitle');
                    if (qrTitleElement) {
                        qrTitleElement.textContent = '請讓其他玩家掃描此QR碼加入';
                    }
                    
                    // 保存offer信號，供後續使用
                    this.hostOfferSignal = data;
                }
            });

            this.hostPeer.on('connect', () => {
                console.log('玩家連接成功');
                console.log('最終信令狀態:', this.hostPeer.signalingState || 'undefined');
                console.log('最終連接狀態:', this.hostPeer.connectionState || 'undefined');
                this.addChatMessage('玩家已連接');
                this.addRoomMessage('玩家已連接');
                // 連接建立後，停止掃描並返回房間區域
                this.stopScanning();
                this.hideElement('qrContainer');
                this.hideElement('scanContainer');
                this.showRoomArea();
            });

            this.hostPeer.on('error', (err) => {
                console.error('房主peer錯誤:', err);
                this.logError('房主Peer錯誤', `房主連接錯誤: ${err.message}`, err.stack);
                this.addChatMessage(`房主連接錯誤: ${err.message}`);
                
                // 如果是連接失敗，提供重試選項
                if (err.message.includes('Connection failed')) {
                    this.addChatMessage('建議：請檢查網路連接，或嘗試重新創建房間');
                }
            });
            
        } catch (error) {
            console.error('創建房間失敗:', error);
            this.logError('創建房間錯誤', `創建房間失敗: ${error.message}`, error.stack);
            // 顯示錯誤信息給用戶
            this.showElement('mainMenu');
            this.hideElement('roomArea');
        }
    }

    // 房主掃描功能 - 顯示QR碼區域
    async startHostScanning() {
        console.log('房主開始掃描流程');
        this.hideElement('roomArea');
        this.showElement('qrContainer');
        
        // 配置QR碼區域的按鈕
        const btnBackToRoom = document.getElementById('btnBackToRoom');
        const btnScan = document.getElementById('btnScan');
        const qrTitle = document.getElementById('qrTitle');
        
        if (btnBackToRoom) btnBackToRoom.style.display = 'inline-block';
        if (btnScan) btnScan.style.display = 'inline-block';
        if (qrTitle) qrTitle.textContent = '請其他玩家掃描此QR碼加入遊戲';
        
        // 生成新的offer信號
        if (this.hostPeer) {
            this.hostPeer.on('signal', (data) => {
                if (data.type === 'offer') {
                    console.log('房主生成新的offer信號');
                    const compressed = LZString.compressToBase64(JSON.stringify(data));
                    
                    if (this.qrcode) {
                        this.qrcode.makeCode(compressed);
                    }
                    
                    const qrTextElement = document.getElementById('qrText');
                    if (qrTextElement) {
                        qrTextElement.textContent = compressed;
                    }
                }
            });
        }
    }

    // 加入房間
    async joinRoom() {
        console.log('開始加入房間流程');
        try {
            this.hideElement('mainMenu');
            this.showElement('scanContainer');
            
            // 清空手動輸入欄位
            const manualQrInput = document.getElementById('manualQrInput');
            if (manualQrInput) manualQrInput.value = '';
            
            console.log('開始掃描流程');
            await this.startScanning();
        } catch (error) {
            this.logError('加入房間錯誤', `加入房間失敗: ${error.message}`, error.stack);
            console.error('掃描錯誤:', error);
            this.showScanError('掃描失敗，請檢查相機權限或重試', error);
        }
    }

    // 手動貼上QR碼內容加入
    async handleManualJoin(qrText) {
        const statusElement = document.getElementById('scanStatus');
        const errorElement = document.getElementById('scanError');
        const resultElement = document.getElementById('scanResult');
        const scanIndicator = document.getElementById('scanIndicator');
        const feedbackText = document.getElementById('feedbackText');
        const scanProgress = document.getElementById('scanProgress');
        try {
            statusElement.textContent = '正在解析手動輸入的QR碼內容...';
            scanIndicator.className = 'scan-indicator scanning';
            feedbackText.textContent = '正在解析...';
            feedbackText.style.color = '#ffd93d';
            scanProgress.innerHTML = '<div class="scan-progress-fill" style="width: 60%;"></div>';

            // 解析流程與掃描一致
            const decompressed = LZString.decompressFromBase64(qrText);
            if (!decompressed) {
                throw new Error('QR碼格式錯誤，請確認是阿瓦隆遊戲產生的QR碼');
            }
            const data = JSON.parse(decompressed);
            if (!data || typeof data !== 'object') {
                throw new Error('QR碼內容無法解析，請重新貼上');
            }
            if (typeof SimplePeer === 'undefined') {
                this.logError('SimplePeer庫載入', `SimplePeer庫載入失敗`);
                throw new Error('SimplePeer 庫未載入');
            }
            const peer = new SimplePeer({ 
                initiator: false, 
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' },
                        { urls: 'stun:stun3.l.google.com:19302' },
                        { urls: 'stun:stun4.l.google.com:19302' }
                    ]
                }
            });
            this.setupPeer(peer);
            console.log('手動加入者創建peer完成');
            console.log('手動加入者peer初始信令狀態:', peer.signalingState);
            
            // 使用保存的peer來處理offer信號
            try {
                peer.signal(data);
                console.log('成功發送offer信號給加入者peer');
                console.log('處理offer後的信令狀態:', peer.signalingState);
            } catch (error) {
                console.error('發送offer信號失敗:', error);
                this.logError('Peer錯誤', `處理offer信號失敗: ${error.message}`);
            }
            
            // 移除舊的signal事件處理，現在在setupPeer中統一處理
        } catch (e) {
            this.logError('解析錯誤', `手動QR碼解析失敗: ${e.message}`);
            resultElement.innerHTML = `
                <div style="background: #f8d7da; color: #721c24; padding: 10px; border-radius: 5px; margin: 10px 0;">
                    <strong>解析失敗:</strong> ${e.message}
                </div>
            `;
            scanIndicator.className = 'scan-indicator';
            feedbackText.textContent = '❌ 解析失敗';
            feedbackText.style.color = '#ff6b6b';
            scanProgress.innerHTML = '';
        }
    }

    // 開始掃描 - 使用qr-test.html的邏輯
    async startScanning() {
        if (this.isScanning) {
            console.log('掃描器已在運行中，忽略重複請求');
            return;
        }

        const statusElement = document.getElementById('scanStatus');
        const errorElement = document.getElementById('scanError');
        const resultElement = document.getElementById('scanResult');
        const videoElement = document.getElementById('scan');
        const retryButton = document.getElementById('retryScan');
        const btnBackToQR = document.getElementById('btnBackToQR');
        const scanIndicator = document.getElementById('scanIndicator');
        const feedbackText = document.getElementById('feedbackText');
        const scanProgress = document.getElementById('scanProgress');
        
        // 清除之前的錯誤和結果
        errorElement.style.display = 'none';
        errorElement.innerHTML = '';
        resultElement.innerHTML = '';
        retryButton.style.display = 'none';
        btnBackToQR.style.display = 'none';
        
        // 配置按鈕顯示
        if (this.transport.isHostPlayer()) {
            // 房主模式：顯示重新掃描和返回按鈕
            retryButton.style.display = 'inline-block';
            btnBackToQR.style.display = 'inline-block';
            btnBackToQR.textContent = '← 返回QR碼';
            statusElement.textContent = '房主掃描模式 - 請掃描玩家的連接QR碼';
        } else {
            // 加入者模式：顯示重新掃描和返回按鈕
            retryButton.style.display = 'inline-block';
            btnBackToQR.style.display = 'inline-block';
            btnBackToQR.textContent = '← 返回主選單';
            statusElement.textContent = '請掃描房主的QR碼加入遊戲';
        }
        
        // 綁定重新掃描按鈕事件
        retryButton.addEventListener('click', () => {
            console.log('點擊重新掃描按鈕');
            this.startScanning();
        });
        
        // 初始化掃描回饋
        scanIndicator.className = 'scan-indicator';
        feedbackText.textContent = '請將QR碼對準綠色框框內';
        scanProgress.innerHTML = '';
        
        try {
            this.isScanning = true;
            console.log('開始掃描流程');
            statusElement.textContent = '正在檢查掃描器庫...';
            
            // 檢查 ZXing 是否可用
            if (typeof ZXing === 'undefined') {
                throw new Error('ZXing 庫未載入，請檢查網路連接');
            }

            console.log('創建ZXing掃描器');
            statusElement.textContent = '正在創建掃描器...';
            
            // 創建 ZXing 掃描器實例
            this.codeReader = new ZXing.BrowserMultiFormatReader();
            
            console.log('啟動掃描器');
            statusElement.textContent = '正在啟動相機...';
            
            // 啟動掃描器
            await this.codeReader.decodeFromVideoDevice(
                null, // 使用預設相機
                videoElement,
                (result, error) => {
                    if (result) {
                        // 掃描成功
                        const decodedText = result.getText();
                        console.log('QR掃描成功:', decodedText.substring(0, 50) + '...');
                        statusElement.textContent = '掃描成功！';
                        
                        // 顯示掃描成功回饋
                        scanIndicator.className = 'scan-indicator detected';
                        feedbackText.textContent = '✅ QR碼掃描成功！正在處理...';
                        feedbackText.style.color = '#00b894';
                        
                        // 顯示進度條
                        scanProgress.innerHTML = '<div class="scan-progress-fill" style="width: 100%;"></div>';
                        
                        // 嘗試解析資料
                        try {
                            console.log('解析QR碼資料');
                            const decompressed = LZString.decompressFromBase64(decodedText);
                            if (!decompressed) {
                                throw new Error('QR碼格式錯誤，請確認是阿瓦隆遊戲產生的QR碼');
                            }
                            const data = JSON.parse(decompressed);
                            if (!data || typeof data !== 'object') {
                                throw new Error('QR碼內容無法解析，請重新掃描');
                            }
                            console.log('解析成功，資料類型:', data.type || 'unknown');
                            
                            // 根據信號類型處理
                            if (data.type === 'offer') {
                                // 加入者收到房主的offer
                                console.log('加入者收到房主offer');
                                console.log('加入者收到offer時的信令狀態: 尚未創建peer');
                                
                                this.logError('SimplePeer庫載入', `SimplePeer庫載入成功`);
                                if (typeof SimplePeer === 'undefined') {
                                    this.logError('SimplePeer庫載入', `SimplePeer庫載入失敗`);
                                    throw new Error('SimplePeer 庫未載入');
                                }
                                const peer = new SimplePeer({ 
                                    initiator: false, 
                                    config: {
                                        iceServers: [
                                            { urls: 'stun:stun.l.google.com:19302' },
                                            { urls: 'stun:stun1.l.google.com:19302' },
                                            { urls: 'stun:stun2.l.google.com:19302' },
                                            { urls: 'stun:stun3.l.google.com:19302' },
                                            { urls: 'stun:stun4.l.google.com:19302' }
                                        ]
                                    }
                                });
                                this.setupPeer(peer);
                                console.log('加入者創建peer完成');
                                console.log('加入者peer初始信令狀態:', peer.signalingState);
                                
                                console.log('發送信號資料');
                                this.logError('發送信號資料', `發送信號資料: ${peer || 'unknown'}`);
                                
                                // 使用保存的peer來處理offer信號
                                try {
                                    peer.signal(data);
                                    console.log('成功發送offer信號給加入者peer');
                                    console.log('處理offer後的信令狀態:', peer.signalingState);
                                } catch (error) {
                                    console.error('發送offer信號失敗:', error);
                                    this.logError('Peer錯誤', `處理offer信號失敗: ${error.message}`);
                                }
                            } else if (data.type === 'answer') {
                                // 房主收到加入者的answer
                                console.log('房主收到加入者answer');
                                console.log('收到answer時的信令狀態:', this.hostPeer.signalingState);
                                console.log('收到answer時的連接狀態:', this.hostPeer.connectionState);
                                
                                // 檢查是否有可用的hostPeer
                                if (!this.hostPeer || this.hostPeer.destroyed) {
                                    console.error('hostPeer不存在或已銷毀');
                                    this.logError('Peer錯誤', '房主peer已失效，請重新創建房間');
                                    return;
                                }
                                
                                // 檢查是否已經連接
                                if (this.hostPeer.connected) {
                                    console.log('已經連接，忽略重複的answer信號');
                                    return;
                                }
                                
                                // 移除過於嚴格的信令狀態檢查，改為更寬鬆的檢查
                                console.log('當前信令狀態:', this.hostPeer.signalingState);
                                console.log('當前連接狀態:', this.hostPeer.connectionState);
                                
                                // 只有在信令狀態明顯錯誤時才拒絕
                                if (this.hostPeer.signalingState === 'closed') {
                                    console.error('信令狀態已關閉，無法處理answer');
                                    this.logError('Peer錯誤', '信令連接已關閉，請重新創建房間');
                                    return;
                                }
                                
                                // 使用保存的hostPeer來處理answer
                                try {
                                    console.log('使用hostPeer處理answer信號');
                                    this.hostPeer.signal(data);
                                    console.log('answer信號處理完成，新信令狀態:', this.hostPeer.signalingState);
                                } catch (error) {
                                    console.error('發送answer信號失敗:', error);
                                    this.logError('Peer錯誤', `處理answer信號失敗: ${error.message}`);
                                }
                            } else {
                                throw new Error('未知的信號類型: ' + data.type);
                            }
                        } catch (e) {
                            this.logError('解析錯誤', `QR碼解析失敗: ${e.message}`);
                            resultElement.innerHTML = `
                                <div style="background: #f8d7da; color: #721c24; padding: 10px; border-radius: 5px; margin: 10px 0;">
                                    <strong>解析失敗:</strong> ${e.message}
                                </div>
                            `;
                            this.stopScanning();
                            return;
                        }
                        
                        this.stopScanning();
                    }
                    
                    if (error && error.name !== 'NotFoundException') {
                        // 掃描錯誤（非致命）
                        // this.logError('QR掃描錯誤', `掃描過程錯誤: ${error.message}`);
                        statusElement.textContent = '正在掃描，請對準QR碼...';
                        
                        // 顯示掃描中回饋
                        scanIndicator.className = 'scan-indicator scanning';
                        feedbackText.textContent = '🔍 正在掃描，請保持QR碼在框框內';
                        feedbackText.style.color = '#ffd93d';
                    } else if (error && error.name === 'NotFoundException') {
                        // 未找到QR碼，顯示掃描中狀態
                        scanIndicator.className = 'scan-indicator scanning';
                        feedbackText.textContent = '🔍 正在掃描，請將QR碼對準綠色框框';
                        feedbackText.style.color = '#ffd93d';
                        
                        // 顯示掃描進度動畫
                        const progress = Math.random() * 30 + 10; // 10-40%的隨機進度
                        scanProgress.innerHTML = `<div class="scan-progress-fill" style="width: ${progress}%;"></div>`;
                    }
                    // NotFoundException 是正常的，表示還沒掃描到QR碼，不需要記錄為錯誤
                }
            );

            console.log('掃描器啟動成功');
            statusElement.textContent = '掃描器已啟動，請對準QR碼';
            
            // 顯示掃描中狀態
            scanIndicator.className = 'scan-indicator scanning';
            feedbackText.textContent = '🔍 掃描器已啟動，請將QR碼對準綠色框框';
            feedbackText.style.color = '#ffd93d';

        } catch (error) {
            this.logError('掃描錯誤', `掃描器啟動失敗: ${error.message}`, error.stack);
            console.error('掃描器啟動失敗:', error);
            this.isScanning = false;
            statusElement.textContent = '掃描器啟動失敗';
            
            // 顯示錯誤狀態
            scanIndicator.className = 'scan-indicator';
            feedbackText.textContent = '❌ 掃描器啟動失敗';
            feedbackText.style.color = '#ff6b6b';
            scanProgress.innerHTML = '';
            
            // 在頁面上顯示詳細錯誤
            let errorMessage = error.message;
            let errorDetails = '';
            let solution = '';

            // 根據錯誤類型提供具體建議
            if (error.name === 'NotAllowedError') {
                errorMessage = '相機權限被拒絕';
                errorDetails = '瀏覽器拒絕了相機權限請求';
                solution = '請點擊網址列左側的相機圖示允許權限，或重新載入頁面';
            } else if (error.name === 'NotFoundError') {
                errorMessage = '找不到相機設備';
                errorDetails = '系統無法找到可用的相機設備';
                solution = '請確認設備有相機，且沒有被其他應用程式使用';
            } else if (error.name === 'NotSupportedError') {
                errorMessage = '瀏覽器不支援相機功能';
                errorDetails = '當前瀏覽器不支援getUserMedia API';
                solution = '請使用Chrome、Firefox、Safari或Edge瀏覽器';
            } else if (error.name === 'NotReadableError') {
                errorMessage = '相機被其他應用程式佔用';
                errorDetails = '相機正在被其他應用程式使用';
                solution = '請關閉其他使用相機的應用程式（如相機、視訊通話等）';
            } else if (error.name === 'OverconstrainedError') {
                errorMessage = '相機配置不支援';
                errorDetails = '請求的相機配置不被設備支援';
                solution = '請嘗試重新載入頁面或使用不同的瀏覽器';
            } else if (error.message.includes('ZXing')) {
                errorMessage = '掃描器庫載入失敗';
                errorDetails = '無法載入ZXing庫';
                solution = '請檢查網路連接，重新載入頁面';
            } else if (error.message.includes('HTTPS')) {
                errorMessage = '需要HTTPS連接';
                errorDetails = '相機功能需要安全的HTTPS連接';
                solution = '請使用HTTPS網址或localhost';
            } else if (error.message.includes('permission')) {
                errorMessage = '權限問題';
                errorDetails = error.message;
                solution = '請在瀏覽器設定中允許相機權限';
            } else if (error.message.includes('decodeFromVideoDevice')) {
                errorMessage = '掃描器啟動失敗';
                errorDetails = 'ZXing啟動過程中發生錯誤';
                solution = '請嘗試重新載入頁面或使用不同的瀏覽器';
            }

            // 顯示錯誤訊息
            errorElement.innerHTML = `
                <div style="background: #f8d7da; color: #721c24; padding: 15px; border-radius: 5px;">
                    <strong>錯誤類型:</strong> ${errorMessage}<br>
                    <strong>錯誤詳情:</strong> ${errorDetails}<br>
                    <strong>解決方案:</strong> ${solution}<br>
                    <strong>錯誤名稱:</strong> ${error.name}<br>
                    <strong>完整錯誤:</strong><br>
                    <div style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 3px; padding: 10px; margin: 10px 0; font-family: monospace; font-size: 12px; overflow-x: auto;">${error.stack || error.message}</div>
                </div>
            `;
            errorElement.style.display = 'inline-block';
            retryButton.style.display = 'inline-block';
        }
    }

    // 停止掃描
    stopScanning() {
        const statusElement = document.getElementById('scanStatus');
        const videoElement = document.getElementById('scan');
        
        if (this.codeReader && this.isScanning) {
            this.codeReader.reset();
        }
        
        // 停止相機流
        if (videoElement.srcObject) {
            const stream = videoElement.srcObject;
            stream.getTracks().forEach(track => track.stop());
            videoElement.srcObject = null;
        }
        
        this.isScanning = false;
        statusElement.textContent = '掃描已停止';
        console.log('掃描流程結束');
    }

    // 顯示掃描錯誤
    showScanError(message, error) {
        const statusElement = document.getElementById('scanStatus');
        const retryButton = document.getElementById('retryScan');
        const errorElement = document.getElementById('scanError');
        
        statusElement.textContent = message;
        statusElement.style.color = '#dc3545';
        retryButton.style.display = 'inline-block';
        
        if (error) {
            errorElement.innerHTML = `
                <div style="background: #f8d7da; color: #721c24; padding: 15px; border-radius: 5px;">
                    <strong>錯誤詳情:</strong> ${error.message}
                </div>
            `;
            errorElement.style.display = 'inline-block';
        }
    }

    // 設置對等連接
    setupPeer(peer) {
        console.log('開始設置WebRTC連接');
        console.log('設置peer時的信令狀態:', peer.signalingState || 'undefined');

        // 將peer添加到transport層
        this.transport.addPeer(peer);

        peer.on('signal', (data) => {
            console.log('發送信號:', data.type || 'unknown');
            console.log('發送信號時的信令狀態:', peer.signalingState || 'undefined');
            
            // 如果是加入者且收到offer，需要將answer回傳給房主
            if (data.type === 'answer') {
                console.log('加入者發送answer信號給房主');
                console.log('發送answer時的信令狀態:', peer.signalingState || 'undefined');
                // 將answer編碼成QR碼顯示，讓房主掃描
                const compressed = LZString.compressToBase64(JSON.stringify(data));
                
                // 檢查QRCode是否可用
                if (this.qrcode) {
                    this.qrcode.makeCode(compressed);
                }
                
                // 檢查QR碼文字元素是否存在
                const qrTextElement = document.getElementById('qrText');
                if (qrTextElement) {
                    qrTextElement.textContent = compressed;
                }
                
                // 顯示QR碼給房主掃描
                this.hideElement('scanContainer');
                this.showElement('qrContainer');
                
                const qrTitleElement = document.getElementById('qrTitle');
                if (qrTitleElement) {
                    qrTitleElement.textContent = '請讓房主掃描此QR碼完成連接';
                }
                
                this.addChatMessage('已生成連接QR碼，請讓房主掃描');
            }
        });

        peer.on('connect', () => {
            console.log('WebRTC連接建立成功');
            console.log('連接建立時的信令狀態:', peer.signalingState || 'undefined');
            console.log('連接建立時的連接狀態:', peer.connectionState || 'undefined');
            this.addChatMessage('WebRTC連接已建立');
            
            // 連接建立後，停止掃描
            console.log('開始UI切換...');
            this.stopScanning();
            console.log('掃描已停止');
            
            this.hideElement('qrContainer');
            console.log('QR容器已隱藏');
            
            this.hideElement('scanContainer');
            console.log('掃描容器已隱藏');
            
            // 根據角色顯示不同區域
            if (this.transport.isHostPlayer()) {
                // 房主保持在房間區域
                this.showRoomArea();
                console.log('房主保持在房間區域');
            } else {
                // 加入者進入房間區域
                this.showRoomArea();
                console.log('加入者進入房間區域');
                
                // 加入者通知房主已加入
                this.transport.send({
                    type: 'player_joined',
                    playerId: this.transport.getCurrentPlayerId(),
                    playerName: '玩家' + this.transport.getCurrentPlayerId().substr(-4)
                });
            }
        });

        peer.on('error', (err) => {
            console.error('WebRTC連接錯誤:', err);
            console.error('錯誤發生時的信令狀態:', peer.signalingState || 'undefined');
            console.error('錯誤發生時的連接狀態:', peer.connectionState || 'undefined');
            
            // 根據錯誤類型提供更具體的錯誤信息
            let errorMessage = 'WebRTC連接錯誤';
            if (err.message.includes('ICE')) {
                errorMessage = '網路連接問題，請檢查網路設置';
            } else if (err.message.includes('signaling')) {
                errorMessage = '信令交換失敗，請重新嘗試連接';
            } else if (err.message.includes('peer')) {
                errorMessage = '對等連接失敗，請重新掃描QR碼';
            } else if (err.message.includes('Connection failed')) {
                errorMessage = '連接建立失敗，可能是網路問題或防火牆阻擋';
            }
            
            this.logError('Peer錯誤', `${errorMessage}: ${err.message}`, err.stack);
            
            // 提供重試選項
            this.addChatMessage(`連接失敗: ${errorMessage}`);
            
            // 如果不是致命錯誤，嘗試重新連接
            if (err.message.includes('ICE') || err.message.includes('signaling') || err.message.includes('Connection failed')) {
                console.log('嘗試重新建立連接...');
                setTimeout(() => {
                    if (!peer.destroyed && !peer.connected) {
                        console.log('重新嘗試信令交換...');
                        // 這裡可以添加重連邏輯
                        this.addChatMessage('正在嘗試重新連接...');
                    }
                }, 2000);
            }
        });

        peer.on('close', () => {
            console.log('WebRTC連接已關閉');
            console.log('連接關閉時的信令狀態:', peer.signalingState || 'undefined');
            this.addChatMessage('WebRTC連接已關閉');
        });

        // 添加連接狀態變更監控
        if (peer.connectionState !== undefined) {
            peer.on('connectionStateChange', () => {
                console.log('連接狀態變更:', peer.connectionState);
                console.log('信令狀態:', peer.signalingState || 'undefined');
                
                switch (peer.connectionState) {
                    case 'new':
                        console.log('連接初始化中...');
                        break;
                    case 'connecting':
                        console.log('正在建立連接...');
                        this.addChatMessage('正在建立連接...');
                        break;
                    case 'connected':
                        console.log('連接已建立');
                        this.addChatMessage('連接已建立');
                        break;
                    case 'disconnected':
                        console.log('連接已斷開');
                        this.addChatMessage('連接已斷開，嘗試重新連接...');
                        break;
                    case 'failed':
                        console.log('連接失敗');
                        this.addChatMessage('連接失敗，請重新嘗試');
                        break;
                    case 'closed':
                        console.log('連接已關閉');
                        this.addChatMessage('連接已關閉');
                        break;
                }
            });
        }

        // 添加信令狀態變更監控
        if (peer.signalingState !== undefined) {
            peer.on('signalingStateChange', () => {
                console.log('信令狀態變更:', peer.signalingState);
                
                switch (peer.signalingState) {
                    case 'stable':
                        console.log('信令狀態穩定');
                        break;
                    case 'have-local-offer':
                        console.log('已發送本地offer');
                        break;
                    case 'have-remote-offer':
                        console.log('已收到遠程offer');
                        break;
                    case 'have-local-pranswer':
                        console.log('已發送本地pranswer');
                        break;
                    case 'have-remote-pranswer':
                        console.log('已收到遠程pranswer');
                        break;
                    case 'closed':
                        console.log('信令狀態已關閉');
                        break;
                }
            });
        }

        peer.on('data', (data) => {
            try {
                const message = JSON.parse(data);
                console.log('收到數據:', message.type || 'unknown');
                this.transport.handleMessage(message);
            } catch (error) {
                console.error('數據解析失敗:', error);
                this.logError('Peer數據錯誤', `數據解析失敗: ${error.message}`);
            }
        });
    }

    // 更新玩家列表
    updatePlayerList(players) {
        const playerList = document.getElementById('playerList');
        if (!playerList) {
            console.warn('playerList 元素不存在，跳過更新');
            return;
        }
        
        playerList.innerHTML = '';
        
        players.forEach(player => {
            const playerItem = document.createElement('div');
            playerItem.className = 'player-item';
            playerItem.innerHTML = `
                <span>${player.name}</span>
                <span>${player.ready ? '✅' : '⏳'}</span>
            `;
            playerList.appendChild(playerItem);
        });
    }

    // 顯示角色卡片
    showRoleCard(role, isGood, gameInfo) {
        this.myRole = { role, isGood, gameInfo };
        
        const roleName = document.getElementById('roleName');
        const roleDescription = document.getElementById('roleDescription');
        
        if (roleName) {
            roleName.textContent = this.getRoleName(role);
        }
        
        if (roleDescription) {
            roleDescription.textContent = this.getRoleDescription(role, isGood, gameInfo);
        }
        
        this.showElement('roleCard');
        this.showElement('gameArea');
        this.hideElement('qrContainer');
    }

    // 獲取角色名稱
    getRoleName(role) {
        const names = {
            'Merlin': '梅林',
            'Percival': '派西維爾',
            'Loyal Servant': '忠誠的僕人',
            'Morgana': '莫甘娜',
            'Mordred': '莫德雷德',
            'Oberon': '奧伯倫',
            'Assassin': '刺客'
        };
        return names[role] || role;
    }

    // 獲取角色描述
    getRoleDescription(role, isGood, gameInfo) {
        const descriptions = {
            'Merlin': '你知道所有壞人的身份（除了莫德雷德）',
            'Percival': '你知道梅林和莫甘娜的身份',
            'Loyal Servant': '你是忠誠的好人',
            'Morgana': '你假裝是梅林來迷惑派西維爾',
            'Mordred': '梅林看不到你的身份',
            'Oberon': '你不知道其他壞人的身份',
            'Assassin': '遊戲結束後你可以刺殺梅林'
        };
        return descriptions[role] || '未知角色';
    }

    // 更新遊戲狀態
    updateGameState(state, data) {
        const status = document.getElementById('status');
        if (!status) {
            console.warn('status 元素不存在，跳過更新遊戲狀態');
            return;
        }
        
        switch (state) {
            case 'WAITING_FOR_PLAYERS':
                status.textContent = '等待玩家加入...';
                break;
            case 'GAME_START':
                status.textContent = '遊戲開始！';
                break;
            case 'MISSION_SELECTION':
                status.textContent = `第${data.missionNumber}輪任務 - 選擇${data.missionSize}名成員`;
                this.updateMissionProgress(data.missionNumber, data.missionSize);
                break;
            case 'MISSION_VOTE':
                status.textContent = '任務投票中...';
                this.showVoteButtons();
                break;
            case 'GAME_END':
                status.textContent = '遊戲結束！';
                break;
        }
    }

    // 更新任務進度
    updateMissionProgress(missionNumber, missionSize) {
        const progressFill = document.getElementById('progressFill');
        const missionInfo = document.getElementById('missionInfo');
        
        const progress = (missionNumber / 5) * 100;
        progressFill.style.width = `${progress}%`;
        missionInfo.textContent = `第${missionNumber}輪任務 - 需要${missionSize}名成員`;
        
        this.showElement('missionProgress');
    }

    // 顯示投票按鈕
    showVoteButtons() {
        this.showElement('voteButtons');
    }

    // 隱藏投票按鈕
    hideVoteButtons() {
        this.hideElement('voteButtons');
    }

    // 投票
    vote(success) {
        this.transport.send({
            type: 'mission_vote',
            playerId: this.transport.getCurrentPlayerId(),
            vote: success
        });
        
        this.hideVoteButtons();
        this.addChatMessage(`你投票: ${success ? '成功' : '失敗'}`);
    }

    // 添加聊天訊息
    addChatMessage(message) {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) {
            console.warn('chatMessages 元素不存在，跳過添加聊天訊息');
            return;
        }
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        messageDiv.textContent = message;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // 顯示元素
    showElement(elementId) {
        document.getElementById(elementId).classList.remove('hidden');
    }

    // 隱藏元素
    hideElement(elementId) {
        document.getElementById(elementId).classList.add('hidden');
    }

    showSimplePeerError() {
        const mainMenu = document.getElementById('mainMenu');
        if (!mainMenu) {
            console.error('mainMenu 元素不存在，無法顯示 SimplePeer 錯誤');
            return;
        }
        
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            background: #ff6b6b;
            color: white;
            padding: 15px;
            margin: 20px 0;
            border-radius: 10px;
            text-align: center;
        `;
        errorDiv.innerHTML = `
            <h3>⚠️ 庫載入失敗</h3>
            <p>SimplePeer 庫載入失敗，加入房間功能可能無法使用。</p>
            <p>請嘗試：</p>
            <ul style="text-align: left; display: inline-block;">
                <li>重新載入頁面</li>
                <li>檢查網路連接</li>
                <li>使用不同的瀏覽器</li>
            </ul>
            <button onclick="location.reload()" class="btn" style="margin-top: 10px;">重新載入</button>
        `;
        mainMenu.appendChild(errorDiv);
    }

    setupErrorHandling() {
        // 設置全域錯誤處理
        window.addEventListener('error', (event) => {
            this.logError('全域錯誤', event.error || event.message, event.error?.stack);
        });

        window.addEventListener('unhandledrejection', (event) => {
            this.logError('未處理的Promise拒絕', event.reason, event.reason?.stack);
        });

        // 設置清除錯誤按鈕（如果存在）
        const clearErrorsBtn = document.getElementById('clearErrors');
        if (clearErrorsBtn) {
            clearErrorsBtn.addEventListener('click', () => {
                this.clearErrors();
            });
        }
    }

    logError(type, message, stack = null) {
        const errorContainer = document.getElementById('errorContainer');
        const errorMessages = document.getElementById('errorMessages');
        
        // 如果錯誤容器不存在，只記錄到控制台
        if (!errorContainer || !errorMessages) {
            console.error(`[${type}] ${message}`, stack);
            return;
        }
        
        // 顯示錯誤容器
        errorContainer.classList.remove('hidden');
        
        // 創建錯誤訊息元素
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        
        const time = new Date().toLocaleTimeString();
        let errorHtml = `<div class="error-time">[${time}] ${type}</div>`;
        errorHtml += `<div class="error-content">${message}</div>`;
        
        if (stack) {
            errorHtml += `<div class="error-stack">${stack}</div>`;
        }
        
        errorDiv.innerHTML = errorHtml;
        errorMessages.appendChild(errorDiv);
        
        // 限制錯誤訊息數量，避免記憶體洩漏
        const errorElements = errorMessages.children;
        if (errorElements.length > 10) {
            errorMessages.removeChild(errorElements[0]);
        }
    }

    clearErrors() {
        const errorMessages = document.getElementById('errorMessages');
        const errorContainer = document.getElementById('errorContainer');
        
        if (errorMessages) {
            errorMessages.innerHTML = '';
        }
        
        if (errorContainer) {
            errorContainer.classList.add('hidden');
        }
    }

    // 顯示房間區域
    showRoomArea() {
        this.hideAllAreas();
        this.showElement('roomArea');
        
        // 如果是房主，顯示房主控制按鈕
        if (this.transport.isHostPlayer()) {
            this.showElement('hostControls');
            
            // 檢查人數是否支援，如果不支援則隱藏開始遊戲按鈕
            const gameState = this.game.getGameState();
            const btnStartGame = document.getElementById('btnStartGame');
            if (btnStartGame) {
                if (gameState.isSupported) {
                    btnStartGame.style.display = 'inline-block';
                } else {
                    btnStartGame.style.display = 'none';
                }
            }
        } else {
            this.hideElement('hostControls');
        }
        
        // 更新房間狀態和玩家列表
        this.updateRoomStatus();
        this.updateRoomPlayerList();
    }

    // 顯示遊戲操作區域
    showGameOperationArea() {
        this.hideAllAreas();
        this.showElement('gameOperationArea');
        this.setupGameOperationUI();
    }

    // 顯示遊戲查看區域
    showGameViewArea() {
        this.hideAllAreas();
        this.showElement('gameViewArea');
        this.updateGameStats();
    }

    // 隱藏所有區域
    hideAllAreas() {
        this.hideElement('mainMenu');
        this.hideElement('qrContainer');
        this.hideElement('scanContainer');
        this.hideElement('gameArea');
        this.hideElement('roomArea');
        this.hideElement('gameOperationArea');
        this.hideElement('gameViewArea');
    }

    // 更新房間狀態
    updateRoomStatus() {
        const roomStatus = document.getElementById('roomStatus');
        let playerCount = this.transport.getConnectedPlayerCount();
        
        // 如果是房主，加上房主自己
        if (this.transport.isHostPlayer()) {
            playerCount += 1;
        }
        
        const supportedPlayerCounts = [5, 6, 7, 8, 9, 10];
        const isSupported = supportedPlayerCounts.includes(playerCount);
        
        if (playerCount < 5) {
            roomStatus.textContent = `等待玩家加入... (${playerCount}/5)`;
        } else if (playerCount > 10) {
            roomStatus.textContent = `房間已滿 (${playerCount}/10)`;
        } else if (isSupported) {
            roomStatus.textContent = `準備開始遊戲 (${playerCount}/10)`;
        } else {
            roomStatus.textContent = `人數不支援 (${playerCount}人，需要5-10人)`;
        }
        
        // 如果是房主，更新開始遊戲按鈕的顯示
        if (this.transport.isHostPlayer()) {
            const btnStartGame = document.getElementById('btnStartGame');
            if (btnStartGame) {
                if (isSupported) {
                    btnStartGame.style.display = 'inline-block';
                } else {
                    btnStartGame.style.display = 'none';
                }
            }
        }
    }

    // 設置遊戲操作UI
    setupGameOperationUI() {
        this.updatePlayerAvatars();
        this.updateGamePhase();
    }

    // 更新玩家頭像
    updatePlayerAvatars() {
        const leftPlayers = document.getElementById('leftPlayers');
        const rightPlayers = document.getElementById('rightPlayers');
        
        leftPlayers.innerHTML = '';
        rightPlayers.innerHTML = '';
        
        // 獲取包含房主的完整玩家列表
        const gameState = this.game.getGameState();
        const allPlayers = gameState.players || [];
        
        allPlayers.forEach((player, index) => {
            const avatar = this.createPlayerAvatar(player, index + 1);
            
            // 分配玩家到左右兩側
            if (index < Math.ceil(allPlayers.length / 2)) {
                leftPlayers.appendChild(avatar);
            } else {
                rightPlayers.appendChild(avatar);
            }
        });
    }

    // 創建玩家頭像
    createPlayerAvatar(player, number) {
        const avatar = document.createElement('div');
        avatar.className = 'player-avatar';
        avatar.textContent = player.name.charAt(0).toUpperCase();
        
        // 添加玩家編號
        const numberDiv = document.createElement('div');
        numberDiv.className = 'player-number';
        numberDiv.textContent = number;
        avatar.appendChild(numberDiv);
        
        // 如果是壞人且當前玩家是梅林，顯示紅點
        if (this.myRole && this.myRole.role === 'Merlin' && !player.isGood) {
            avatar.classList.add('evil');
        }
        
        return avatar;
    }

    // 更新遊戲階段
    updateGamePhase() {
        const gamePhase = document.getElementById('gamePhase');
        const currentPhaseText = document.getElementById('currentPhaseText');
        
        const gameState = this.game.getGameState();
        
        switch (gameState.state) {
            case 'MISSION_SELECTION':
                gamePhase.textContent = '組隊階段';
                const missionSize = this.game.getMissionSize ? this.game.getMissionSize(gameState.currentMission, gameState.players.length) : 2;
                currentPhaseText.textContent = `第${gameState.currentMission}輪任務 - 選擇${missionSize}名成員`;
                break;
            case 'MISSION_VOTE':
                gamePhase.textContent = '投票階段';
                currentPhaseText.textContent = '請對任務成員進行投票';
                break;
            case 'MISSION_EXECUTION':
                gamePhase.textContent = '執行階段';
                currentPhaseText.textContent = '任務執行中...';
                break;
            default:
                gamePhase.textContent = '遊戲進行中';
                currentPhaseText.textContent = '等待遊戲開始...';
        }
    }

    // 更新遊戲統計
    updateGameStats() {
        this.updateMissionStats();
        this.updateVoteStats();
        this.updatePlayerStats();
    }

    // 更新任務統計
    updateMissionStats() {
        const missionStats = document.getElementById('missionStats');
        const gameState = this.game.getGameState();
        
        let html = '<div class="stats-row stats-header mission-row">';
        html += '<div>任務</div><div>結果</div><div>成員</div>';
        html += '</div>';
        
        gameState.missionResults.forEach((result, index) => {
            html += '<div class="stats-row mission-row">';
            html += `<div>第${index + 1}輪</div>`;
            html += `<div>${result.success ? '✅ 成功' : '❌ 失敗'}</div>`;
            html += `<div>${result.votes.length}人</div>`;
            html += '</div>';
        });
        
        missionStats.innerHTML = html;
    }

    // 更新投票統計
    updateVoteStats() {
        const voteStats = document.getElementById('voteStats');
        const gameState = this.game.getGameState();
        
        let html = '<div class="stats-row stats-header vote-row">';
        html += '<div>任務</div><div>贊成</div><div>反對</div><div>結果</div>';
        html += '</div>';
        
        gameState.missionResults.forEach((result, index) => {
            const successVotes = result.votes.filter(v => v.vote).length;
            const failVotes = result.votes.filter(v => !v.vote).length;
            
            html += '<div class="stats-row vote-row">';
            html += `<div>第${index + 1}輪</div>`;
            html += `<div>${successVotes}</div>`;
            html += `<div>${failVotes}</div>`;
            html += `<div>${result.success ? '成功' : '失敗'}</div>`;
            html += '</div>';
        });
        
        voteStats.innerHTML = html;
    }

    // 更新玩家統計
    updatePlayerStats() {
        const playerStats = document.getElementById('playerStats');
        const gameState = this.game.getGameState();
        
        let html = '<div class="stats-row stats-header player-row">';
        html += '<div>玩家</div><div>角色</div><div>陣營</div><div>狀態</div>';
        html += '</div>';
        
        gameState.players.forEach((player, index) => {
            const role = gameState.roles.find(r => r.playerId === player.id);
            
            html += '<div class="stats-row player-row">';
            html += `<div>${player.name}</div>`;
            html += `<div>${role ? this.getRoleName(role.role) : '未知'}</div>`;
            html += `<div>${role ? (role.isGood ? '好人' : '壞人') : '未知'}</div>`;
            html += `<div>${player.ready ? '準備' : '等待'}</div>`;
            html += '</div>';
        });
        
        playerStats.innerHTML = html;
    }

    // 開始遊戲
    startGame() {
        if (this.transport.isHostPlayer()) {
            // 檢查人數是否支援
            const gameState = this.game.getGameState();
            if (!gameState.isSupported) {
                alert(`不支援 ${gameState.players.length} 人遊戲，需要 5-10 人`);
                return;
            }
            
            this.transport.send({
                type: 'game_action',
                action: 'start_game'
            });
            this.showGameOperationArea();
        }
    }

    // 發送房間訊息
    sendRoomMessage() {
        const input = document.getElementById('roomChatInput');
        const message = input.value.trim();
        
        if (message) {
            this.addRoomMessage(`我: ${message}`);
            this.transport.send({
                type: 'room_message',
                playerId: this.transport.getCurrentPlayerId(),
                message: message
            });
            input.value = '';
        }
    }

    // 添加房間訊息
    addRoomMessage(message) {
        const chatMessages = document.getElementById('roomChatMessages');
        if (!chatMessages) {
            console.warn('roomChatMessages 元素不存在，跳過添加房間訊息');
            return;
        }
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        messageDiv.textContent = message;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // 更新房間玩家列表
    updateRoomPlayerList() {
        const roomPlayerList = document.getElementById('roomPlayerList');
        const gameState = this.game.getGameState();
        const players = gameState.players || [];
        
        roomPlayerList.innerHTML = '';
        
        // 顯示所有玩家（包括房主）
        players.forEach((player, index) => {
            const playerItem = document.createElement('div');
            playerItem.className = 'room-player-item';
            
            playerItem.innerHTML = `
                <div class="room-player-avatar">${player.name.charAt(0).toUpperCase()}</div>
                <div class="room-player-name">${player.name}</div>
                <div class="room-player-status">${player.ready ? '準備' : '等待'}</div>
            `;
            
            roomPlayerList.appendChild(playerItem);
        });
    }

    // 顯示遊戲查看區域
    showGameView() {
        this.showGameViewArea();
    }

    // 顯示遊戲操作區域
    showGameOperation() {
        this.showGameOperationArea();
    }
}

// ==================== 初始化 ====================

// 初始化應用程式
document.addEventListener('DOMContentLoaded', () => {
    console.log('阿瓦隆遊戲初始化中...');
    
    // 延遲一點時間確保所有腳本都載入完成
    setTimeout(() => {
        initializeGame();
    }, 100);
});

function initializeGame() {
    // 檢查必要的類別是否載入
    if (typeof TransportLayer === 'undefined') {
        console.error('TransportLayer 類別未載入！');
        return;
    }
    
    if (typeof AvalonGame === 'undefined') {
        console.error('AvalonGame 類別未載入！');
        return;
    }
    
    if (typeof UIController === 'undefined') {
        console.error('UIController 類別未載入！');
        return;
    }
    
    // 強制清除快取
    if ('caches' in window) {
        caches.keys().then(names => {
            names.forEach(name => {
                caches.delete(name);
            });
        });
    }
    
    try {
        // 初始化遊戲
        const transport = new TransportLayer();
        const game = new AvalonGame(transport);
        window.ui = new UIController(game, transport);
        
        // 設置訊息處理器
        transport.onMessage('player_list_update', (msg) => {
            window.ui.updatePlayerList(msg.players);
        });
        
        transport.onMessage('role_assignment', (msg) => {
            window.ui.showRoleCard(msg.role, msg.isGood, msg.gameInfo);
        });
        
        transport.onMessage('game_state', (msg) => {
            window.ui.updateGameState(msg.state, msg);
        });
        
        transport.onMessage('mission_result', (msg) => {
            window.ui.addChatMessage(`第${msg.missionNumber}輪任務: ${msg.success ? '成功' : '失敗'}`);
        });
        
        transport.onMessage('game_result', (msg) => {
            window.ui.addChatMessage(`遊戲結束！${msg.winner === 'good' ? '好人' : '壞人'}獲勝！`);
        });
        
        transport.onMessage('assassination_phase', (msg) => {
            window.ui.addChatMessage('壞人獲勝！刺客可以刺殺梅林...');
        });
        
        transport.onMessage('assassination_result', (msg) => {
            const result = msg.assassinWins ? '刺客成功刺殺梅林！壞人最終獲勝！' : '刺客刺殺失敗！好人最終獲勝！';
            window.ui.addChatMessage(result);
        });
        
        transport.onMessage('room_message', (msg) => {
            const senderName = msg.playerName || `玩家${msg.playerId.substr(-4)}`;
            window.ui.addRoomMessage(`${senderName}: ${msg.message}`);
        });
        
        console.log('阿瓦隆遊戲初始化完成');
    } catch (error) {
        console.error('遊戲初始化失敗:', error);
    }
}

// 頁面卸載時清理資源
window.addEventListener('beforeunload', () => {
    console.log('清理遊戲資源...');
    // 停止所有掃描器
    if (window.ui && window.ui.codeReader) {
        window.ui.stopScanning();
    }
}); 