// ==================== UI控制層 (UI Controller) ====================
// 版本: 1.0.38
// 最後更新: 2024-12-19
// 修復內容: 採用webrtc-chat-test.html的多人連線方式

/**
 * 阿瓦隆遊戲 - UI控制器
 * 版本: 1.0.37
 * 功能: 管理遊戲UI和用戶交互
 */
class UIController {
    constructor(game, transport) {
        this.game = game;
        this.transport = transport;
        this.codeReader = null;
        this.isScanning = false;
        this.qrcode = null;
        this.myRole = null;
        
        // WebRTC 連線相關
        this.peers = new Map(); // 儲存多個peer連接
        this.isHost = false;
        this.connectionState = 'disconnected';
        this.pendingCandidates = [];
        this.hostOfferSignal = null;
        this.currentPeerId = 0;
        
        // 初始化連接日誌
        this.connectionLog = [];
        
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

        // 清空錯誤按鈕
        const clearErrorsBtn = document.getElementById('clearErrorsBtn');
        if (clearErrorsBtn) {
            clearErrorsBtn.addEventListener('click', () => {
                this.clearErrors();
            });
        }

        // 清空連接日誌按鈕
        const clearLogBtn = document.getElementById('clearLogBtn');
        if (clearLogBtn) {
            clearLogBtn.addEventListener('click', () => {
                this.clearConnectionLog();
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
        // 設置player_joined訊息處理器 - 只處理邏輯，不重複顯示訊息
        this.transport.onMessage('player_joined', (data) => {
            console.log('收到玩家加入訊息:', data);
            // 通知遊戲邏輯層處理
            this.game.handlePlayerJoined(data);
        });
        
        // 遊戲事件處理 - 統一在這裡處理UI更新
        this.game.onGameEvent('playerJoined', (data) => {
            this.addRoomMessage(`${data.player.name} 加入了房間`);
            this.updateRoomStatus();
            this.updateRoomPlayerList();
            
            // 如果是房主，發送房間狀態同步給新玩家
            if (this.isHost) {
                this.syncRoomStateToNewPlayer(data.player.id);
            }
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
        
        // 處理房間聊天訊息
        this.transport.onMessage('room_message', (data) => {
            const senderName = data.playerName || `玩家${data.playerId.substr(-4)}`;
            this.addRoomMessage(`${senderName}: ${data.message}`, false);
        });
        
        // 處理房間狀態同步
        this.transport.onMessage('room_sync', (data) => {
            console.log('收到房間狀態同步:', data);
            
            // 同步遊戲狀態
            if (data.gameState) {
                // 更新遊戲邏輯層的狀態
                this.game.syncGameState(data.gameState);
            }
            
            // 同步房間聊天記錄
            if (data.chatHistory) {
                const chatMessages = document.getElementById('chatMessages');
                if (chatMessages) {
                    chatMessages.innerHTML = '';
                    data.chatHistory.forEach(msg => {
                        if (typeof msg === 'string') {
                            // 向後兼容
                            this.addRoomMessage(msg.replace('[系統] ', ''), msg.includes('[系統]'));
                        } else {
                            // 新格式
                            this.addRoomMessage(msg.content.replace('[系統] ', ''), msg.isSystem);
                        }
                    });
                }
            }
            
            // 更新房間狀態和玩家列表
            this.updateRoomStatus();
            this.updateRoomPlayerList();
        });
    }
    
    // 房主同步房間狀態給新玩家
    syncRoomStateToNewPlayer(playerId) {
        try {
            // 收集聊天記錄
            const chatMessages = document.getElementById('chatMessages');
            const chatHistory = [];
            if (chatMessages) {
                const messages = chatMessages.querySelectorAll('.room-message');
                messages.forEach(msg => {
                    chatHistory.push({
                        content: msg.textContent,
                        isSystem: msg.classList.contains('system')
                    });
                });
            }
            
            // 發送房間狀態同步訊息
            const syncData = {
                type: 'room_sync',
                chatHistory: chatHistory,
                gameState: this.game.getGameState()
            };
            
            // 廣播給所有連接的peer
            this.transport.broadcast(syncData);
            this.logConnection(`房主：已同步房間狀態給新玩家 ${playerId}`, 'info');
            
        } catch (error) {
            this.logConnection(`房間狀態同步失敗: ${error.message}`, 'error');
        }
    }

    // 創建房間 - 房主模式
    async createRoom() {
        this.isHost = true;
        this.transport.setHostStatus(true);
        
        // 確保房主被添加到遊戲邏輯層
        this.game.addHostPlayer();
        
        this.hideElement('mainMenu');
        this.showRoomArea();
        
        this.addRoomMessage('房間已創建，等待玩家加入...');
        this.logConnection('房主模式：房間創建完成', 'success');
    }

    // 房主添加新玩家連線
    async addNewPlayerConnection() {
        try {
            // 檢查SimplePeer是否可用
            if (typeof SimplePeer === 'undefined') {
                throw new Error('SimplePeer 庫未載入，請檢查網路連接');
            }
            
            const peerId = `peer_${++this.currentPeerId}`;
            this.logConnection(`房主：為新玩家創建連線 ${peerId}`, 'info');
            
            // 創建新的peer連接
            const peer = new SimplePeer({ 
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
            
            // 儲存peer連接
            this.peers.set(peerId, {
                peer: peer,
                connected: false,
                pendingCandidates: [],
                offerProcessed: false,
                answerProcessed: false
            });
            
            this.setupPeerEvents(peer, peerId);
            
            this.logConnection(`房主：Peer ${peerId} 創建成功，等待生成offer信號`, 'info');
            return peerId;
            
        } catch (error) {
            console.error('創建玩家連線失敗:', error);
            this.logConnection(`創建玩家連線失敗: ${error.message}`, 'error');
            throw error;
        }
    }

    // 房主顯示QR碼給新玩家掃描
    async startHostScanning() {
        try {
            console.log('房主開始添加新玩家流程');
            this.hideElement('roomArea');
            this.showElement('qrContainer');
            
            // 配置QR碼區域的按鈕
            const btnBackToRoom = document.getElementById('btnBackToRoom');
            const btnScan = document.getElementById('btnScan');
            const qrTitle = document.getElementById('qrTitle');
            
            if (btnBackToRoom) btnBackToRoom.style.display = 'inline-block';
            if (btnScan) btnScan.style.display = 'inline-block';
            if (qrTitle) qrTitle.textContent = '請新玩家掃描此QR碼加入遊戲';
            
            // 為新玩家創建連線
            const peerId = await this.addNewPlayerConnection();
            this.logConnection(`房主：等待 ${peerId} 的offer信號生成`, 'info');
            
        } catch (error) {
            this.logConnection(`房主添加玩家失敗: ${error.message}`, 'error');
            this.hideElement('qrContainer');
            this.showRoomArea();
        }
    }

    // 加入房間 - 玩家模式
    async joinRoom() {
        this.isHost = false;
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

    // 加入者建立連線
    async connectAsJoiner(signalText) {
        try {
            this.logConnection('加入者：開始建立連線', 'info');
            
            // 設置加入者狀態
            this.isHost = false;
            this.transport.setHostStatus(false);
            
            // 檢查SimplePeer是否可用
            if (typeof SimplePeer === 'undefined') {
                throw new Error('SimplePeer 庫未載入，請檢查網路連接');
            }
            
            // 解析信號
            const decompressed = LZString.decompressFromBase64(signalText);
            if (!decompressed) {
                throw new Error('信號格式錯誤，請確認是阿瓦隆遊戲產生的QR碼');
            }
            
            const data = JSON.parse(decompressed);
            
            // 創建peer連接
            const peerId = 'joiner_peer';
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
            
            // 儲存peer連接
            this.peers.set(peerId, {
                peer: peer,
                connected: false,
                pendingCandidates: [],
                offerProcessed: false,
                answerProcessed: false
            });
            
            this.setupPeerEvents(peer, peerId);
            
            // 處理信號
            if (Array.isArray(data)) {
                this.logConnection(`加入者：收到 ${data.length} 個信號`, 'info');
                this.processSignalArray(data, peerId);
            } else {
                if (data.type !== 'offer') {
                    throw new Error('不是有效的offer信號');
                }
                this.processSingleSignal(data, peerId);
            }
            
        } catch (error) {
            this.logConnection(`加入者連接失敗: ${error.message}`, 'error');
            throw error;
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

            // 根據身份使用不同的連線方式
            if (this.isHost) {
                // 房主處理加入者回應
                await this.handleHostScanResponse(qrText);
            } else {
                // 加入者連接房主
                await this.connectAsJoiner(qrText);
            }
            
            // 連線成功，顯示成功狀態
            statusElement.textContent = '連線建立中，請等待...';
            scanIndicator.className = 'scan-indicator success';
            feedbackText.textContent = '✅ 連線建立中';
            feedbackText.style.color = '#4caf50';
            scanProgress.innerHTML = '<div class="scan-progress-fill" style="width: 100%;"></div>';
            
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

    // 處理信號數組
    processSignalArray(signals, peerId) {
        const peerInfo = this.peers.get(peerId);
        if (!peerInfo) {
            this.logConnection(`錯誤：未找到 ${peerId} 的連接信息`, 'error');
            return;
        }

        // 過濾和驗證信號
        const validSignals = signals.filter((signal, index) => {
            if (!signal || typeof signal !== 'object') {
                this.logConnection(`跳過無效信號 ${index + 1}: 不是對象`, 'warning');
                return false;
            }
            
            if (!signal.type) {
                this.logConnection(`跳過無效信號 ${index + 1}: 缺少type屬性`, 'warning');
                return false;
            }
            
            // 驗證信號類型
            const validTypes = ['offer', 'answer', 'candidate'];
            if (!validTypes.includes(signal.type)) {
                this.logConnection(`跳過無效信號 ${index + 1}: 未知類型 ${signal.type}`, 'warning');
                return false;
            }
            
            // 檢查信號是否已經處理過
            if (signal.type === 'offer' && peerInfo.offerProcessed) {
                this.logConnection(`跳過已處理的offer信號 ${index + 1}`, 'warning');
                return false;
            }
            
            if (signal.type === 'answer' && peerInfo.answerProcessed) {
                this.logConnection(`跳過已處理的answer信號 ${index + 1}`, 'warning');
                return false;
            }
            
            return true;
        });

        this.logConnection(`過濾後有效信號數量: ${validSignals.length}/${signals.length}`, 'info');

        validSignals.forEach((signal, index) => {
            this.logConnection(`處理信號 ${index + 1}/${validSignals.length}: ${signal.type}`, 'info');
            try {
                // 檢查peer連接狀態
                const connectionState = peerInfo.peer._pc ? peerInfo.peer._pc.connectionState : 'unknown';
                const signalingState = peerInfo.peer._pc ? peerInfo.peer._pc.signalingState : 'unknown';
                
                this.logConnection(`${peerId} 連接狀態: ${connectionState}, 信令狀態: ${signalingState}`, 'info');
                
                // 根據信號類型和當前狀態決定是否處理
                if (signal.type === 'answer') {
                    // 對於answer信號，只有在已經處理過或者不是initiator時才跳過
                    if (peerInfo.answerProcessed) {
                        this.logConnection(`跳過已處理的answer信號`, 'warning');
                        return;
                    }
                    if (signalingState === 'stable' && !peerInfo.peer.initiator) {
                        this.logConnection(`跳過answer信號，非initiator且已stable`, 'warning');
                        return;
                    }
                }
                
                if (signal.type === 'offer') {
                    // 對於offer信號，只有在已經處理過或者是initiator時才跳過
                    if (peerInfo.offerProcessed) {
                        this.logConnection(`跳過已處理的offer信號`, 'warning');
                        return;
                    }
                    if (signalingState !== 'stable' && peerInfo.peer.initiator) {
                        this.logConnection(`跳過offer信號，initiator且不在stable狀態`, 'warning');
                        return;
                    }
                }
                
                peerInfo.peer.signal(signal);
                this.logConnection(`信號 ${signal.type} 處理成功`, 'success');
                
                // 標記信號已處理
                if (signal.type === 'offer') {
                    peerInfo.offerProcessed = true;
                } else if (signal.type === 'answer') {
                    peerInfo.answerProcessed = true;
                }
                
            } catch (error) {
                this.logConnection(`信號 ${signal.type} 處理失敗: ${error.message}`, 'error');
            }
        });
    }

    // 處理單個信號
    processSingleSignal(signal, peerId) {
        const peerInfo = this.peers.get(peerId);
        if (!peerInfo) {
            this.logConnection(`錯誤：未找到 ${peerId} 的連接信息`, 'error');
            return;
        }

        this.logConnection(`處理單個信號: ${signal.type}`, 'info');
        try {
            // 檢查peer連接狀態
            const connectionState = peerInfo.peer._pc ? peerInfo.peer._pc.connectionState : 'unknown';
            const signalingState = peerInfo.peer._pc ? peerInfo.peer._pc.signalingState : 'unknown';
            
            this.logConnection(`${peerId} 連接狀態: ${connectionState}, 信令狀態: ${signalingState}`, 'info');
            
            // 檢查信號是否已經處理過
            if (signal.type === 'offer' && peerInfo.offerProcessed) {
                this.logConnection(`跳過已處理的offer信號`, 'warning');
                return;
            }
            
            if (signal.type === 'answer' && peerInfo.answerProcessed) {
                this.logConnection(`跳過已處理的answer信號`, 'warning');
                return;
            }
            
            // 根據信號類型和當前狀態決定是否處理
            if (signal.type === 'answer') {
                // 對於answer信號，只有在已經處理過或者不是initiator時才跳過
                if (peerInfo.answerProcessed) {
                    this.logConnection(`跳過已處理的answer信號`, 'warning');
                    return;
                }
                if (signalingState === 'stable' && !peerInfo.peer.initiator) {
                    this.logConnection(`跳過answer信號，非initiator且已stable`, 'warning');
                    return;
                }
            }
            
            if (signal.type === 'offer') {
                // 對於offer信號，只有在已經處理過或者是initiator時才跳過
                if (peerInfo.offerProcessed) {
                    this.logConnection(`跳過已處理的offer信號`, 'warning');
                    return;
                }
                if (signalingState !== 'stable' && peerInfo.peer.initiator) {
                    this.logConnection(`跳過offer信號，initiator且不在stable狀態`, 'warning');
                    return;
                }
            }
            
            peerInfo.peer.signal(signal);
            this.logConnection(`信號 ${signal.type} 處理成功`, 'success');
            
            // 標記信號已處理
            if (signal.type === 'offer') {
                peerInfo.offerProcessed = true;
            } else if (signal.type === 'answer') {
                peerInfo.answerProcessed = true;
            }
            
        } catch (error) {
            this.logConnection(`信號 ${signal.type} 處理失敗: ${error.message}`, 'error');
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
        if (this.isHost) {
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
                async (result, error) => {
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
                        
                        // 使用新的連線方式處理掃描結果
                        try {
                            if (this.isHost) {
                                // 房主掃描加入者回應
                                await this.handleHostScanResponse(decodedText);
                            } else {
                                // 加入者掃描房主offer
                                await this.connectAsJoiner(decodedText);
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

        // 初始化pendingCandidates
        if (!this.pendingCandidates) {
            this.pendingCandidates = [];
        }

        // 將peer添加到transport層
        this.transport.addPeer(peer);

        // 設置訊息處理器已在transport層的addPeer方法中處理，這裡不需要重複設置

        peer.on('signal', (data) => {
            console.log('發送信號:', data.type || 'unknown');
            console.log('發送信號時的信令狀態:', peer.signalingState || 'undefined');
            
            if (data.type === 'offer') {
                // 房主生成offer信號
                console.log('房主生成offer信號');
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
                
                this.addChatMessage('已生成連接QR碼，請讓其他玩家掃描');
                
            } else if (data.type === 'answer') {
                // 加入者生成answer信號
                console.log('加入者發送answer信號給房主');
                console.log('發送answer時的信令狀態:', peer.signalingState || 'undefined');
                
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
                
            } else if (data.type === 'candidate') {
                // ICE候選信號，需要即時交換
                const candidateInfo = data.candidate ? 
                    (data.candidate.substring ? data.candidate.substring(0, 50) + '...' : String(data.candidate).substring(0, 50) + '...') : 
                    'null';
                console.log(`生成ICE候選信號: ${candidateInfo}`);
                
                // 將ICE候選信號添加到待發送列表
                this.pendingCandidates.push(data);
                
                // 更新信號顯示
                this.updateSignalDisplay();
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
                
                // 加入者通知房主已加入，直接使用peer發送
                const joinMessage = {
                    type: 'player_joined',
                    playerId: this.transport.getCurrentPlayerId(),
                    playerName: '玩家' + this.transport.getCurrentPlayerId().substr(-4)
                };
                peer.send(JSON.stringify(joinMessage));
                console.log('加入者發送player_joined訊息:', joinMessage);
            }
        });

        peer.on('error', (err) => {
            console.error('WebRTC連接錯誤:', err);
            console.error('錯誤發生時的信令狀態:', peer.signalingState || 'undefined');
            console.error('錯誤發生時的連接狀態:', peer.connectionState || 'undefined');
            
            // 根據錯誤類型提供更具體的錯誤信息
            let errorMessage = 'WebRTC連接錯誤';
            if (err.message.includes('Failed to set remote answer sdp')) {
                errorMessage = '重複發送answer信號，請重新開始連接';
            } else if (err.message.includes('Failed to set remote offer sdp')) {
                errorMessage = '重複發送offer信號，請重新開始連接';
            } else if (err.message.includes('ICE')) {
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
            
            // 如果是重複信號錯誤，建議重置
            if (err.message.includes('Failed to set remote')) {
                console.log('建議：重新開始連接');
                this.addChatMessage('建議重新開始連接');
            }
        });

        peer.on('close', () => {
            console.log('WebRTC連接已關閉');
            console.log('連接關閉時的信令狀態:', peer.signalingState || 'undefined');
            this.addChatMessage('WebRTC連接已關閉');
        });

        // 添加ICE連接狀態監控
        peer.on('iceStateChange', (state) => {
            console.log(`ICE連接狀態變化: ${state}`);
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

    // 更新信號顯示
    updateSignalDisplay() {
        if (!this.pendingCandidates || this.pendingCandidates.length === 0) return;
        
        // 過濾有效的ICE候選信號
        const validCandidates = this.pendingCandidates.filter(candidate => {
            return candidate && candidate.type === 'candidate';
        });
        
        if (validCandidates.length === 0) {
            console.log('沒有有效的ICE候選信號');
            this.pendingCandidates = [];
            return;
        }
        
        // 更新QR碼顯示，包含ICE候選信號
        const qrTextElement = document.getElementById('qrText');
        if (qrTextElement && qrTextElement.textContent) {
            try {
                const currentSignal = JSON.parse(LZString.decompressFromBase64(qrTextElement.textContent));
                if (currentSignal && (currentSignal.type === 'offer' || currentSignal.type === 'answer')) {
                    const updatedSignals = [currentSignal, ...validCandidates];
                    const updatedCompressed = LZString.compressToBase64(JSON.stringify(updatedSignals));
                    
                    // 更新QR碼
                    if (this.qrcode) {
                        this.qrcode.makeCode(updatedCompressed);
                    }
                    
                    // 更新文字
                    qrTextElement.textContent = updatedCompressed;
                    console.log(`信號已更新，包含 ${validCandidates.length} 個有效ICE候選`);
                }
            } catch (error) {
                console.log(`信號更新失敗: ${error.message}`);
            }
        }
        
        // 清空待發送列表，避免重複添加
        this.pendingCandidates = [];
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
        const timestamp = new Date().toLocaleTimeString();
        const errorLog = document.getElementById('errorLog');
        
        if (errorLog) {
            const errorEntry = document.createElement('div');
            errorEntry.className = 'error-entry';
            errorEntry.innerHTML = `
                <span class="error-time">[${timestamp}]</span>
                <span class="error-type">${type}:</span>
                <span class="error-message">${message}</span>
                ${stack ? `<details><summary>詳細資訊</summary><pre>${stack}</pre></details>` : ''}
            `;
            errorLog.appendChild(errorEntry);
            errorLog.scrollTop = errorLog.scrollHeight;
        }
        
        console.error(`[${timestamp}] ${type}: ${message}`, stack);
    }

    // 添加連接日誌
    logConnection(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        this.connectionLog.push({ timestamp, message, type });
        
        const connectionLogElement = document.getElementById('connectionLog');
        if (connectionLogElement) {
            const logEntry = document.createElement('div');
            logEntry.className = `log-entry log-${type}`;
            logEntry.innerHTML = `
                <span class="log-time">[${timestamp}]</span>
                <span class="log-message">${message}</span>
            `;
            connectionLogElement.appendChild(logEntry);
            connectionLogElement.scrollTop = connectionLogElement.scrollHeight;
        }
        
        console.log(`[${timestamp}] ${message}`);
    }

    // 清空連接日誌
    clearConnectionLog() {
        this.connectionLog = [];
        const connectionLogElement = document.getElementById('connectionLog');
        if (connectionLogElement) {
            connectionLogElement.innerHTML = '';
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
        
        // 使用this.isHost來檢查房主狀態，更準確
        if (this.isHost) {
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
        const gameState = this.game.getGameState();
        const playerCount = gameState.players ? gameState.players.length : 0;
        
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
        if (this.isHost) {
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
            const playerName = this.isHost ? '房主' : '玩家' + this.transport.getCurrentPlayerId().substr(-4);
            
            // 本地顯示
            this.addRoomMessage(`${playerName}: ${message}`, false);
            
            // 廣播給其他玩家
            this.transport.broadcast({
                type: 'room_message',
                playerId: this.transport.getCurrentPlayerId(),
                playerName: playerName,
                message: message
            });
            
            input.value = '';
        }
    }

    // 添加房間訊息
    addRoomMessage(message, isSystem = true) {
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) {
            const messageDiv = document.createElement('div');
            messageDiv.className = isSystem ? 'room-message system' : 'room-message user';
            messageDiv.textContent = isSystem ? `[系統] ${message}` : message;
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        } else {
            console.warn('chatMessages 元素不存在，跳過添加房間訊息');
        }
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

    // 設置Peer事件處理器（支援多人連線）
    setupPeerEvents(peer, peerId) {
        const peerInfo = this.peers.get(peerId);
        if (!peerInfo) {
            this.logConnection(`錯誤：未找到 ${peerId} 的連接信息`, 'error');
            return;
        }
        
        this.logConnection(`設置 ${peerId} 的事件處理器`, 'info');

        // 將peer添加到transport層
        this.transport.addPeer(peer);

        peer.on('signal', (data) => {
            this.logConnection(`${peerId} 生成信號: ${data.type}`, 'info');
            
            if (data.type === 'offer') {
                // 房主生成offer信號
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
                
                this.logConnection(`房主 offer 信號已生成給 ${peerId}`, 'success');
                
            } else if (data.type === 'answer') {
                // 加入者生成answer信號
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
                
                this.logConnection(`加入者 answer 信號已生成`, 'success');
                
            } else if (data.type === 'candidate') {
                // ICE候選信號，添加到待處理列表
                if (!peerInfo.pendingCandidates) {
                    peerInfo.pendingCandidates = [];
                }
                peerInfo.pendingCandidates.push(data);
                
                // 更新信號顯示
                this.updateSignalDisplay(peerId);
            }
        });

        peer.on('connect', () => {
            this.logConnection(`${peerId} WebRTC連接建立成功`, 'success');
            peerInfo.connected = true;
            this.connectionState = 'connected';
            
            // 連接建立後，停止掃描
            this.stopScanning();
            this.hideElement('qrContainer');
            this.hideElement('scanContainer');
            
            // 根據角色顯示不同區域
            if (this.isHost) {
                // 房主保持在房間區域
                this.showRoomArea();
                this.logConnection('房主保持在房間區域', 'info');
            } else {
                // 加入者進入房間區域
                this.showRoomArea();
                this.logConnection('加入者進入房間區域', 'info');
                
                // 加入者通知房主已加入
                const joinMessage = {
                    type: 'player_joined',
                    playerId: this.transport.getCurrentPlayerId(),
                    playerName: '玩家' + this.transport.getCurrentPlayerId().substr(-4)
                };
                peer.send(JSON.stringify(joinMessage));
                this.logConnection(`加入者發送player_joined訊息: ${joinMessage.playerName}`, 'info');
            }
        });

        peer.on('error', (err) => {
            this.logConnection(`${peerId} 連接錯誤: ${err.message}`, 'error');
            
            // 根據錯誤類型提供更具體的錯誤信息
            let errorMessage = 'WebRTC連接錯誤';
            if (err.message.includes('Failed to set remote answer sdp')) {
                errorMessage = '重複發送answer信號，請重新開始連接';
            } else if (err.message.includes('Failed to set remote offer sdp')) {
                errorMessage = '重複發送offer信號，請重新開始連接';
            } else if (err.message.includes('ICE')) {
                errorMessage = '網路連接問題，請檢查網路設置';
            } else if (err.message.includes('signaling')) {
                errorMessage = '信令交換失敗，請重新嘗試連接';
            }
            
            this.logError('Peer錯誤', `${errorMessage}: ${err.message}`, err.stack);
        });

        peer.on('close', () => {
            this.logConnection(`${peerId} 連接已關閉`, 'warning');
            peerInfo.connected = false;
        });

        peer.on('data', (data) => {
            try {
                const message = JSON.parse(data);
                this.logConnection(`${peerId} 收到數據: ${message.type || 'unknown'}`, 'info');
                this.transport.handleMessage(message);
            } catch (error) {
                this.logConnection(`${peerId} 數據解析失敗: ${error.message}`, 'error');
            }
        });
    }

    // 更新信號顯示
    updateSignalDisplay(peerId) {
        const peerInfo = this.peers.get(peerId);
        if (!peerInfo || !peerInfo.pendingCandidates || peerInfo.pendingCandidates.length === 0) return;
        
        // 過濾有效的ICE候選信號
        const validCandidates = peerInfo.pendingCandidates.filter(candidate => {
            return candidate && candidate.type === 'candidate';
        });
        
        if (validCandidates.length === 0) {
            this.logConnection(`${peerId} 沒有有效的ICE候選信號`, 'info');
            peerInfo.pendingCandidates = [];
            return;
        }
        
        // 更新QR碼顯示，包含ICE候選信號
        const qrTextElement = document.getElementById('qrText');
        if (qrTextElement && qrTextElement.textContent) {
            try {
                const currentSignal = JSON.parse(LZString.decompressFromBase64(qrTextElement.textContent));
                if (currentSignal && (currentSignal.type === 'offer' || currentSignal.type === 'answer')) {
                    const updatedSignals = [currentSignal, ...validCandidates];
                    const updatedCompressed = LZString.compressToBase64(JSON.stringify(updatedSignals));
                    
                    // 更新QR碼
                    if (this.qrcode) {
                        this.qrcode.makeCode(updatedCompressed);
                    }
                    
                    // 更新文字
                    qrTextElement.textContent = updatedCompressed;
                    this.logConnection(`${peerId} 信號已更新，包含 ${validCandidates.length} 個有效ICE候選`, 'info');
                }
            } catch (error) {
                this.logConnection(`${peerId} 信號更新失敗: ${error.message}`, 'error');
            }
        }
        
        // 清空待發送列表，避免重複添加
        peerInfo.pendingCandidates = [];
    }

    // 房主掃描加入者回應（支援多人）
    async handleHostScanResponse(signalText) {
        try {
            this.logConnection('房主：開始處理加入者回應', 'info');
            
            // 解析信號
            const decompressed = LZString.decompressFromBase64(signalText);
            if (!decompressed) {
                throw new Error('回應信號格式錯誤');
            }
            
            const data = JSON.parse(decompressed);
            
            // 找到等待回應的peer連接
            let targetPeerId = null;
            for (const [peerId, peerInfo] of this.peers) {
                if (!peerInfo.answerProcessed && !peerInfo.connected) {
                    targetPeerId = peerId;
                    break;
                }
            }
            
            if (!targetPeerId) {
                throw new Error('沒有找到等待回應的連接');
            }
            
            // 處理信號
            if (Array.isArray(data)) {
                this.logConnection(`房主：收到 ${data.length} 個回應信號`, 'info');
                this.processSignalArray(data, targetPeerId);
            } else {
                if (data.type !== 'answer') {
                    throw new Error('不是有效的answer信號');
                }
                this.processSingleSignal(data, targetPeerId);
            }
            
        } catch (error) {
            this.logConnection(`房主處理回應失敗: ${error.message}`, 'error');
            throw error;
        }
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