// ==================== 資料傳輸層 (Transport Layer) ====================
// 版本: 1.0.36
// 最後更新: 2024-12-19

class TransportLayer {
    constructor() {
        this.peers = new Map();
        this.messageHandlers = new Map();
        this.isHost = false;
        this.playerId = this.generatePlayerId();
        this.onConnectCallback = null;
        this.onDisconnectCallback = null;
    }

    generatePlayerId() {
        return 'player_' + Math.random().toString(36).substr(2, 9);
    }

    // 註冊訊息處理器
    onMessage(type, handler) {
        this.messageHandlers.set(type, handler);
    }

    // 註冊連接回調
    onConnect(callback) {
        this.onConnectCallback = callback;
    }

    // 註冊斷線回調
    onDisconnect(callback) {
        this.onDisconnectCallback = callback;
    }

    // 發送訊息
    send(message) {
        const messageStr = JSON.stringify(message);
        this.peers.forEach(peerInfo => {
            if (peerInfo.connected) {
                peerInfo.peer.send(messageStr);
            }
        });
    }

    // 處理接收到的訊息
    handleMessage(data) {
        try {
            let message;
            
            // 檢查數據類型
            if (typeof data === 'string') {
                // 如果是字符串，嘗試解析JSON
                message = JSON.parse(data);
            } else if (data instanceof Uint8Array) {
                // 如果是Uint8Array，轉換為字符串再解析
                const dataString = new TextDecoder().decode(data);
                message = JSON.parse(dataString);
            } else if (typeof data === 'object' && data !== null) {
                // 如果已經是對象，直接使用
                message = data;
            } else {
                console.error('無效的訊息數據類型:', typeof data);
                return;
            }
            
            // 檢查訊息格式
            if (!message || typeof message !== 'object') {
                console.error('無效的訊息格式:', message);
                return;
            }
            
            if (!message.type) {
                console.error('訊息缺少type屬性:', message);
                return;
            }
            
            const handler = this.messageHandlers.get(message.type);
            if (handler) {
                handler(message);
            } else {
                console.warn('未找到訊息處理器:', message.type);
            }
        } catch (error) {
            console.error('訊息解析錯誤:', error);
            console.error('原始數據:', data);
        }
    }

    // 添加對等連接
    addPeer(peer) {
        const peerId = peer.id || this.generatePlayerId();
        peer.id = peerId;
        
        // 使用自定義的連接狀態追蹤
        const peerInfo = {
            peer: peer,
            connected: false,
            id: peerId
        };
        
        this.peers.set(peerId, peerInfo);

        peer.on('data', (data) => {
            this.handleMessage(data);
        });

        peer.on('connect', () => {
            peerInfo.connected = true;
            console.log('玩家連接成功:', peerId);
            if (this.onConnectCallback) {
                this.onConnectCallback(peerId);
            }
        });

        peer.on('close', () => {
            peerInfo.connected = false;
            console.log('玩家斷線:', peerId);
            if (this.onDisconnectCallback) {
                this.onDisconnectCallback(peerId);
            }
        });

        peer.on('error', (err) => {
            console.error('Peer錯誤:', peerId, err);
            peerInfo.connected = false;
        });
    }

    // 獲取連接的玩家數量
    getConnectedPlayerCount() {
        return Array.from(this.peers.values()).filter(peerInfo => peerInfo.connected).length;
    }

    // 獲取所有玩家ID
    getPlayerIds() {
        return Array.from(this.peers.keys());
    }

    // 檢查是否為房主
    isHostPlayer() {
        return this.isHost;
    }

    // 獲取當前玩家ID
    getCurrentPlayerId() {
        return this.playerId;
    }

    // 設置房主狀態
    setHostStatus(isHost) {
        this.isHost = isHost;
    }

    // 廣播訊息給所有玩家
    broadcast(message) {
        this.send(message);
    }

    // 發送訊息給特定玩家
    sendToPlayer(playerId, message) {
        const peerInfo = this.peers.get(playerId);
        if (peerInfo && peerInfo.connected) {
            const messageStr = JSON.stringify(message);
            peerInfo.peer.send(messageStr);
        }
    }

    // 清理所有連接
    cleanup() {
        this.peers.forEach(peerInfo => {
            if (peerInfo.peer.destroy) {
                peerInfo.peer.destroy();
            }
        });
        this.peers.clear();
    }
}

// 導出傳輸層類別
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TransportLayer;
} 