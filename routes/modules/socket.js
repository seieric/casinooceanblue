/**
 * socket.ioのルーティング
 * @param io
 */
module.exports = (io) => {
    // PostgreSQLクライアントの初期化
    const db = require('../modules/database');

    // クライアントの生存確認
    io.set('heartbeat interval', 5000);
    io.set('heartbeat timeout', 10000);

    // 待ち列を初期化
    let waitingStore = [];
    // ゲーム情報のストアを初期化
    let gameStore = {};

    // クライアントの認証
    io.use( async (socket, next) => {
        const token = socket.handshake.query.token;
        let isAuthenticated = false;
        const query = {
            text: "SELECT * FROM users WHERE token=$1",
            values: [token]
        };
        await db.query(query, (err, result) => {
            if(err){
                return next(new Error("[SQLite]Something went wrong."));
            }
            if(result.rowCount === 1){
                socket._name = result.rows[0].name;
                socket._gameId = "";
                socket._score = 0;
                isAuthenticated = true;
            }
            if(!isAuthenticated){
                return next(new Error('[Socket.io]Authentication error.'));
            }
            return next();
        });
    });

    // 2秒毎にトークンの更新を確認
    setInterval(() => {
        const rooms = io.sockets.adapter.rooms;
        for(let roomId in rooms){
            if(rooms[roomId].length >= 2){
                let gameInfo = gameStore[roomId];
                const now = new Date();
                if(gameInfo.tokenExpire !== null && gameInfo.isStarted){
                    // トークンの有効期限が過ぎていれば更新
                    if(gameInfo.tokenExpire < now){
                        const expire = 15;
                        gameInfo.token = require('crypto').randomBytes(12).toString('hex');
                        gameInfo.tokenExpire = new Date(new Date().getTime() + expire*1000);
                        if((gameInfo.users.length - 1) <= gameInfo.next){
                            gameInfo.next = 0;
                        }else{
                            gameInfo.next += 1;
                        }
                        io.to(gameInfo.users[gameInfo.next]).emit('turn', {token: gameInfo.token});
                        console.debug("Token has been updated!");
                        gameStore[gameInfo.id] = gameInfo;
                    }
                }
            }
        }
    }, 2000);

    // Socket.io ルーティング
    io.sockets.on('connection', socket => {
        console.log(`[Socket.io]Client(${socket.id}) connected!`);
        console.debug("[DEBUG] waitingStore is $s", JSON.stringify(waitingStore));

        // 待ち列が空でないことの確認
        if(waitingStore != ""){
            let waitingGameId = waitingStore[0];
            console.debug("[DEBUG] waitingGameId is now" + waitingGameId);
            if(gameStore[waitingGameId] != null){
                let numOfUsers = gameStore[waitingGameId].users.length;
                console.debug(`[DEBUG] ${gameStore[waitingGameId].id} has ${numOfUsers} now.`);
                socket._gameId = waitingGameId;
                gameStore[waitingGameId].users.push(socket.id);
                // ユーザーはルームに参加済
                socket.join(socket._gameId);
                // 2人未満の場合待ち状態を維持・3人以上揃ったらゲーム開始
                if(2 <= numOfUsers){
                    console.debug(`[DEBUG] ${gameStore[waitingGameId].id} has been started now.`);
                    // 3人以上揃ったので待ち列から削除
                    console.debug(`[DEBUG] Waiting games list is now ${JSON.stringify(waitingStore)}`);
                    waitingStore.shift();
                    // ゲーム開始のシグナルを送る
                    gameStore[waitingGameId].isStarted = true;
                    io.to(socket._gameId).emit('start', {'n':numOfUsers + 1});
                    io.to(gameStore[waitingGameId].users[0]).emit('turn', {token:gameStore[waitingGameId].token});
                    console.debug(`First user is ${gameStore[waitingGameId].users[0]}`);
                    // 配列の前から２番めのユーザーが次のプレイヤー
                    gameStore[waitingGameId].next = 1;
                    // トークンの制限時間を15秒に設定
                    const tokenExpire = 15;
                    gameStore[waitingGameId].tokenExpire = new Date(new Date().getTime() + tokenExpire*1000);
                    console.debug("Game started.");
                }
                console.log(`Client(${socket.id}) joined the game ${socket._gameId}`);
                console.debug(numOfUsers + "in the game");
            }
        }else{
            console.debug("[DEBUG] Create new game.");
            // ルーム情報を初期化
            let gameInfo = {
                id: require('crypto').randomBytes(12).toString('hex'),
                users: [],
                cards: [],
                next: 0,
                token: require('crypto').randomBytes(6).toString('hex'),
                tokenExpire: "",
                cardTmp: null,
                isStarted: false
            };
            // ルームを新規作成して登録
            socket._gameId = gameInfo.id;
            gameInfo.users.push(socket.id);
            // トランプも初期化する
            for(let i=0;i<10;i++){
                gameInfo.cards[i] = gameInfo.cards[i+10] = i;
            }
            let tmp, n;
            for(let i=0;i<20;i++){
                n = Math.floor(Math.random() * 20);
                tmp = gameInfo.cards[n];
                gameInfo.cards[n] = gameInfo.cards[i];
                gameInfo.cards[i] = tmp;
            }
            console.debug("[DEBUG] New gameInfo is ", JSON.stringify(gameInfo));
            gameStore[gameInfo.id] = gameInfo;
            console.debug("[DEBUG] gameInfo is register to store.");
            // ゲームを待ち列に登録
            waitingStore.push(gameInfo.id);

            socket.join(socket._gameId);
            console.log(`Client(${socket.id}) joined the game ${socket._gameId}`);
        }

        // トリガー別の処理
        // カードの照合
        socket.on('cardOpen', (data) => {
            console.debug("[DEBUG]Receive card opening.");
            console.debug(JSON.stringify(data));
            const gameId = socket._gameId;
            // トークンを照合
            if(data.token === gameStore[gameId].token){
                console.debug("[DEBUG]User authorized.");
                let res;
                if(gameStore[gameId].cardTmp != null){
                    // 2枚目の処理
                    console.debug("[DEBUG]Second card.");
                    let firstCard = gameStore[gameId].cards[gameStore[gameId].cardTmp];
                    let secondCard = gameStore[gameId].cards[data.cardPos];
                    // 2つのカードが一致するかどうか
                    if(firstCard === secondCard){
                        // 一致したら加算
                        socket._score += 100;
                        // カード情報を削除
                        gameStore[gameId].cards[gameStore[gameId].cardTmp] = gameStore[gameId].cards[data.cardPos] = null;
                        // 同じユーザーがもう一度プレイ
                        io.to(socket.id).emit('turn', {token: gameStore[gameId].token});
                        console.debug("[DEBUG]Card hit!");
                    }else{
                        // トークンを更新
                        gameStore[gameId].token = require('crypto').randomBytes(6).toString('hex');
                        // 他のユーザーの番になる
                        if(gameStore[gameId].users[gameStore[gameId].next] !== null){
                            io.to(gameStore[gameId].users[gameStore[gameId].next]).emit('turn', {token: gameStore[gameId].token});
                        }else{
                            io.to(gameStore[gameId].users[0]).emit('turn', {token: gameStore[gameId].token});
                        }
                        console.debug(`[DEBUG]Client(${gameStore[gameId].users[gameStore[gameId].next]})'s turn.`);
                        if(gameStore[gameId].next === (gameStore[gameId].users.length - 1)){
                            gameStore[gameId].next = 0;
                        }else{
                            gameStore[gameId].next += 1;
                        }
                    }
                    // 初期化
                    gameStore[gameId].cardTmp = null;
                    res = {
                        cards: [data.cardPos, gameStore[gameId].cards[data.cardPos]]
                    };
                }else{
                    // 1枚目の処理
                    console.debug("[DEBUG]First card.");
                    gameStore[gameId].cardTmp = data.cardPos;
                    res = {
                        cards: [data.cardPos, gameStore[gameId].cards[data.cardPos]]
                    };
                }
                let isFinished = true;
                gameStore[gameId].cards.some((v,i) => {
                    if(v !== null){
                        isFinished = false;
                    }
                });
                if(isFinished){
                    io.sockets.clients(gameId).forEach((client) => {
                        io.to(client.id).emit('finish', {status: "success", rank: 100, score: client._score})
                    });
                }else{
                    io.to(gameId).emit('cardRes', res);
                }
            }
        });

        // 切断時の処理
        socket.on('disconnect', () => {
            console.log(`[Socket.io]Client(${socket.id}) disconnected.`);

            let gameId = socket._gameId;
            // ユーザーをゲーム情報から削除
            if(gameStore[gameId] != null){
                // 退出したユーザーが次のユーザーのとき
                if(gameStore[gameId].users[gameStore[gameId].next] === socket.id){
                    const nextUser = gameStore[gameId].users[gameStore[gameId].next + 1];
                    if(nextUser !== null){
                        gameStore[gameId].next = 0;
                    }else{
                        gameStore[gameId].next += 1;
                    }
                }
                gameStore[gameId].users.some((v, i) => {
                    if (v===socket.id) gameStore[gameId].users.splice(i,1);
                });
                if(gameStore[gameId].users.length <= 1){
                    io.to(socket._gameId).emit('finish', {'status':'exception'});
                    waitingStore.some((v, i) => {
                        if (v===socket._gameId) waitingStore.splice(i,1);
                    });
                    delete gameStore[gameId];
                }
            }
        });

        // 例外処理
        socket.on('error', (details) => {
            console.error(`[Socket.io]Error ${details}`);
        });
    });
}