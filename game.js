// ==================== 遊戲邏輯層 (Game Logic) ====================

class AvalonGame {
    constructor(transport) {
        this.transport = transport;
        this.gameState = 'WAITING_FOR_PLAYERS';
        this.players = [];
        this.roles = [];
        this.currentMission = 0;
        this.missionResults = [];
        this.currentLeader = 0;
        this.selectedMembers = [];
        this.votes = [];
        this.gameCallbacks = new Map();
        
        this.setupMessageHandlers();
    }

    // 註冊遊戲事件回調
    onGameEvent(event, callback) {
        this.gameCallbacks.set(event, callback);
    }

    // 觸發遊戲事件
    triggerGameEvent(event, data) {
        const callback = this.gameCallbacks.get(event);
        if (callback) {
            callback(data);
        }
    }

    setupMessageHandlers() {
        this.transport.onMessage('player_join', (msg) => this.handlePlayerJoin(msg));
        this.transport.onMessage('role_assignment', (msg) => this.handleRoleAssignment(msg));
        this.transport.onMessage('mission_vote', (msg) => this.handleMissionVote(msg));
        this.transport.onMessage('game_action', (msg) => this.handleGameAction(msg));
        this.transport.onMessage('player_ready', (msg) => this.handlePlayerReady(msg));
        this.transport.onMessage('room_message', (msg) => this.handleRoomMessage(msg));
    }

    // 角色配置
    getRoleConfig(playerCount) {
        const configs = {
            5: { good: 3, evil: 2, roles: ['Merlin', 'Percival', 'Loyal Servant', 'Morgana', 'Assassin'] },
            6: { good: 4, evil: 2, roles: ['Merlin', 'Percival', 'Loyal Servant', 'Loyal Servant', 'Morgana', 'Assassin'] },
            7: { good: 4, evil: 3, roles: ['Merlin', 'Percival', 'Loyal Servant', 'Loyal Servant', 'Morgana', 'Oberon', 'Assassin'] },
            8: { good: 5, evil: 3, roles: ['Merlin', 'Percival', 'Loyal Servant', 'Loyal Servant', 'Loyal Servant', 'Morgana', 'Mordred', 'Assassin'] },
            9: { good: 6, evil: 3, roles: ['Merlin', 'Percival', 'Loyal Servant', 'Loyal Servant', 'Loyal Servant', 'Loyal Servant', 'Morgana', 'Mordred', 'Assassin'] },
            10: { good: 6, evil: 4, roles: ['Merlin', 'Percival', 'Loyal Servant', 'Loyal Servant', 'Loyal Servant', 'Loyal Servant', 'Morgana', 'Mordred', 'Oberon', 'Assassin'] }
        };
        return configs[playerCount] || configs[5];
    }

    // 任務成員數量
    getMissionSize(missionNumber, playerCount) {
        const sizes = {
            5: [2, 3, 2, 3, 3],
            6: [2, 3, 4, 3, 4],
            7: [2, 3, 3, 4, 4],
            8: [3, 4, 4, 5, 5],
            9: [3, 4, 4, 5, 5],
            10: [3, 4, 4, 5, 5]
        };
        return sizes[playerCount][missionNumber - 1] || 2;
    }

    // 分配角色
    assignRoles() {
        // 確保房主也在玩家列表中
        const allPlayers = [...this.players];
        if (this.transport.isHostPlayer()) {
            // 如果房主不在玩家列表中，添加房主
            const hostPlayer = {
                id: this.transport.getCurrentPlayerId(),
                name: '房主',
                ready: true
            };
            if (!allPlayers.find(p => p.id === hostPlayer.id)) {
                allPlayers.unshift(hostPlayer); // 房主放在第一位
            }
        }
        
        // 檢查人數是否支援
        const supportedPlayerCounts = [5, 6, 7, 8, 9, 10];
        if (!supportedPlayerCounts.includes(allPlayers.length)) {
            console.error(`不支援 ${allPlayers.length} 人遊戲，需要 5-10 人`);
            this.transport.broadcast({
                type: 'game_error',
                message: `不支援 ${allPlayers.length} 人遊戲，需要 5-10 人`
            });
            return;
        }
        
        const config = this.getRoleConfig(allPlayers.length);
        const shuffledRoles = [...config.roles].sort(() => Math.random() - 0.5);
        
        this.roles = allPlayers.map((player, index) => ({
            playerId: player.id,
            role: shuffledRoles[index],
            isGood: ['Merlin', 'Percival', 'Loyal Servant'].includes(shuffledRoles[index])
        }));

        // 發送角色給每個玩家
        this.roles.forEach(role => {
            this.transport.sendToPlayer(role.playerId, {
                type: 'role_assignment',
                playerId: role.playerId,
                role: role.role,
                isGood: role.isGood,
                gameInfo: this.getGameInfo(role)
            });
        });

        this.gameState = 'GAME_START';
        this.triggerGameEvent('rolesAssigned', { roles: this.roles });
        this.startMission();
    }

    // 獲取遊戲資訊（根據角色）
    getGameInfo(playerRole) {
        const info = {
            evilPlayers: [],
            merlinInfo: null,
            percivalInfo: null
        };

        if (playerRole.role === 'Merlin') {
            // 梅林知道所有壞人（除了莫德雷德）
            info.evilPlayers = this.roles
                .filter(r => !r.isGood && r.role !== 'Mordred')
                .map(r => r.playerId);
        } else if (playerRole.role === 'Percival') {
            // 派西維爾知道梅林和莫甘娜
            const merlin = this.roles.find(r => r.role === 'Merlin');
            const morgana = this.roles.find(r => r.role === 'Morgana');
            info.percivalInfo = [merlin?.playerId, morgana?.playerId].filter(Boolean);
        }

        return info;
    }

    // 開始任務
    startMission() {
        this.currentMission++;
        this.selectedMembers = [];
        this.votes = [];
        
        // 確保房主也在玩家列表中
        const allPlayers = [...this.players];
        if (this.transport.isHostPlayer()) {
            const hostPlayer = {
                id: this.transport.getCurrentPlayerId(),
                name: '房主',
                ready: true
            };
            if (!allPlayers.find(p => p.id === hostPlayer.id)) {
                allPlayers.unshift(hostPlayer);
            }
        }
        
        // 檢查人數是否支援
        const supportedPlayerCounts = [5, 6, 7, 8, 9, 10];
        if (!supportedPlayerCounts.includes(allPlayers.length)) {
            console.error(`不支援 ${allPlayers.length} 人遊戲，需要 5-10 人`);
            return;
        }
        
        const missionSize = this.getMissionSize(this.currentMission, allPlayers.length);
        
        this.transport.broadcast({
            type: 'game_state',
            state: 'MISSION_SELECTION',
            missionNumber: this.currentMission,
            missionSize: missionSize,
            leader: allPlayers[this.currentLeader].id
        });

        this.triggerGameEvent('missionStarted', {
            missionNumber: this.currentMission,
            missionSize: missionSize,
            leader: allPlayers[this.currentLeader].id
        });
    }

    // 處理玩家加入
    handlePlayerJoin(msg) {
        const newPlayer = {
            id: msg.playerId,
            name: msg.playerName || `玩家${this.players.length + 1}`,
            ready: false
        };
        
        this.players.push(newPlayer);
        
        // 廣播玩家列表更新
        this.transport.broadcast({
            type: 'player_list_update',
            players: this.players
        });

        this.triggerGameEvent('playerJoined', { player: newPlayer, players: this.players });

        // 檢查是否可以開始遊戲
        let totalPlayers = this.players.length;
        if (this.transport.isHostPlayer()) {
            totalPlayers += 1; // 加上房主
        }
        
        // 檢查人數是否在支援的範圍內（5-10人）
        const supportedPlayerCounts = [5, 6, 7, 8, 9, 10];
        if (supportedPlayerCounts.includes(totalPlayers) && this.transport.isHostPlayer()) {
            this.transport.broadcast({
                type: 'game_ready',
                canStart: true
            });
        }
    }

    // 處理玩家準備
    handlePlayerReady(msg) {
        const player = this.players.find(p => p.id === msg.playerId);
        if (player) {
            player.ready = true;
            this.transport.broadcast({
                type: 'player_list_update',
                players: this.players
            });
        }
    }

    // 處理角色分配
    handleRoleAssignment(msg) {
        // 這個訊息是發給特定玩家的，不需要廣播
        console.log('角色分配完成');
    }

    // 處理任務投票
    handleMissionVote(msg) {
        this.votes.push({
            playerId: msg.playerId,
            vote: msg.vote
        });

        this.triggerGameEvent('voteReceived', { vote: msg });

        if (this.votes.length === this.selectedMembers.length) {
            this.processMissionResult();
        }
    }

    // 處理遊戲動作
    handleGameAction(msg) {
        switch (msg.action) {
            case 'start_game':
                this.assignRoles();
                break;
            case 'select_members':
                this.selectedMembers = msg.members;
                this.startVoting();
                break;
            case 'assassinate':
                this.handleAssassination(msg.target);
                break;
        }
    }

    // 開始投票
    startVoting() {
        this.votes = [];
        this.gameState = 'MISSION_VOTE';
        
        this.transport.broadcast({
            type: 'game_state',
            state: 'MISSION_VOTE',
            selectedMembers: this.selectedMembers
        });

        this.triggerGameEvent('votingStarted', { selectedMembers: this.selectedMembers });
    }

    // 處理任務結果
    processMissionResult() {
        const successVotes = this.votes.filter(v => v.vote).length;
        const missionSuccess = successVotes === this.selectedMembers.length;
        
        this.missionResults.push({
            mission: this.currentMission,
            success: missionSuccess,
            votes: this.votes
        });

        this.transport.broadcast({
            type: 'mission_result',
            missionNumber: this.currentMission,
            success: missionSuccess,
            votes: this.votes
        });

        this.triggerGameEvent('missionCompleted', {
            missionNumber: this.currentMission,
            success: missionSuccess,
            votes: this.votes
        });

        // 檢查遊戲是否結束
        const goodWins = this.missionResults.filter(r => r.success).length >= 3;
        const evilWins = this.missionResults.filter(r => !r.success).length >= 3;

        if (goodWins || evilWins) {
            this.endGame(goodWins ? 'good' : 'evil');
        } else {
            // 確保房主也在玩家列表中進行隊長輪換
            let allPlayers = [...this.players];
            if (this.transport.isHostPlayer()) {
                const hostPlayer = {
                    id: this.transport.getCurrentPlayerId(),
                    name: '房主',
                    ready: true
                };
                if (!allPlayers.find(p => p.id === hostPlayer.id)) {
                    allPlayers.unshift(hostPlayer);
                }
            }
            
            // 檢查人數是否支援
            const supportedPlayerCounts = [5, 6, 7, 8, 9, 10];
            if (!supportedPlayerCounts.includes(allPlayers.length)) {
                console.error(`不支援 ${allPlayers.length} 人遊戲，需要 5-10 人`);
                return;
            }
            
            // 輪換隊長
            this.currentLeader = (this.currentLeader + 1) % allPlayers.length;
            this.startMission();
        }
    }

    // 結束遊戲
    endGame(winner) {
        this.gameState = 'GAME_END';
        
        this.transport.broadcast({
            type: 'game_result',
            winner: winner,
            missionResults: this.missionResults,
            roles: this.roles
        });

        this.triggerGameEvent('gameEnded', {
            winner: winner,
            missionResults: this.missionResults,
            roles: this.roles
        });

        // 如果壞人獲勝，啟動刺殺階段
        if (winner === 'evil') {
            this.transport.broadcast({
                type: 'assassination_phase',
                roles: this.roles
            });
        }
    }

    // 處理刺殺
    handleAssassination(targetId) {
        const targetRole = this.roles.find(r => r.playerId === targetId);
        const assassinWins = targetRole && targetRole.role === 'Merlin';
        
        this.transport.broadcast({
            type: 'assassination_result',
            target: targetId,
            assassinWins: assassinWins,
            finalWinner: assassinWins ? 'evil' : 'good'
        });

        this.triggerGameEvent('assassinationCompleted', {
            target: targetId,
            assassinWins: assassinWins,
            finalWinner: assassinWins ? 'evil' : 'good'
        });
    }

    // 獲取遊戲狀態
    getGameState() {
        // 確保房主也在玩家列表中
        let allPlayers = [...this.players];
        if (this.transport.isHostPlayer()) {
            const hostPlayer = {
                id: this.transport.getCurrentPlayerId(),
                name: '房主',
                ready: true
            };
            if (!allPlayers.find(p => p.id === hostPlayer.id)) {
                allPlayers.unshift(hostPlayer);
            }
        }
        
        // 檢查人數是否支援
        const supportedPlayerCounts = [5, 6, 7, 8, 9, 10];
        const isSupported = supportedPlayerCounts.includes(allPlayers.length);
        
        return {
            state: this.gameState,
            players: allPlayers,
            roles: this.roles,
            currentMission: this.currentMission,
            missionResults: this.missionResults,
            currentLeader: this.currentLeader,
            selectedMembers: this.selectedMembers,
            votes: this.votes,
            isSupported: isSupported,
            supportedPlayerCounts: supportedPlayerCounts
        };
    }

    // 重置遊戲
    resetGame() {
        this.gameState = 'WAITING_FOR_PLAYERS';
        this.players = [];
        this.roles = [];
        this.currentMission = 0;
        this.missionResults = [];
        this.currentLeader = 0;
        this.selectedMembers = [];
        this.votes = [];
    }

    // 檢查是否可以開始遊戲
    canStartGame() {
        // 確保房主也在玩家列表中
        let totalPlayers = this.players.length;
        if (this.transport.isHostPlayer()) {
            totalPlayers += 1; // 加上房主
        }
        
        // 檢查人數是否在支援的範圍內（5-10人）
        const supportedPlayerCounts = [5, 6, 7, 8, 9, 10];
        return supportedPlayerCounts.includes(totalPlayers);
    }

    // 獲取當前隊長
    getCurrentLeader() {
        // 確保房主也在玩家列表中
        let allPlayers = [...this.players];
        if (this.transport.isHostPlayer()) {
            const hostPlayer = {
                id: this.transport.getCurrentPlayerId(),
                name: '房主',
                ready: true
            };
            if (!allPlayers.find(p => p.id === hostPlayer.id)) {
                allPlayers.unshift(hostPlayer);
            }
        }
        
        // 檢查人數是否支援
        const supportedPlayerCounts = [5, 6, 7, 8, 9, 10];
        if (!supportedPlayerCounts.includes(allPlayers.length)) {
            console.error(`不支援 ${allPlayers.length} 人遊戲，需要 5-10 人`);
            return null;
        }
        
        return allPlayers[this.currentLeader];
    }

    // 獲取任務進度
    getMissionProgress() {
        const goodWins = this.missionResults.filter(r => r.success).length;
        const evilWins = this.missionResults.filter(r => !r.success).length;
        return { goodWins, evilWins, totalMissions: this.missionResults.length };
    }

    // 處理房間訊息
    handleRoomMessage(msg) {
        // 廣播房間訊息給所有玩家
        this.transport.broadcast({
            type: 'room_message',
            playerId: msg.playerId,
            playerName: msg.playerName || `玩家${msg.playerId.substr(-4)}`,
            message: msg.message,
            timestamp: Date.now()
        });
    }
}

// 導出遊戲邏輯類別
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AvalonGame;
} 