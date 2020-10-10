const db = require('../modules/database');
let waitingStore = [];
let gameStore = {};
/**
 * socket.ioのルーティング
 * @param io
 */
module.exports = (io) => {
    io.set('heartbeat interval', 5000);
    io.set('heartbeat timeout', 10000);

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
                socket._token = token;
                isAuthenticated = true;
            }
            if(!isAuthenticated){
                return next(new Error('[Socket.io]Authentication error.'));
            }
            return next();
        });
    });

    // 番になるユーザーを定期的に更新
    setInterval(() => {
        for(let gameId in gameStore){
            const game = gameStore[gameId];
            if(game.users.length >= 2 && game.tokenExpire !== null && game.isStarted){
                const now = new Date();
                // 有効期限が過ぎていれば更新
                if(game.tokenExpire < now){
                    game.tokenExpire = new Date(now.getTime() + 15*1000);
                    if((game.users.length - 1) <= game.next){
                        game.next = 0;
                    }else{
                        game.next += 1;
                    }
                    io.to(game.id).emit('reset');
                    setTimeout(() => {
                        io.to(game.users[game.next]).emit('turn');
                    }, 500);
                    console.debug(`[DEBUG]Game(${game.id})has been updated!: ${game}`);
                    gameStore[game.id] = game;
                }
            }
        }
    }, 5000);

    // Socket.io ルーティング
    io.sockets.on('connection', socket => {
        console.log(`[Socket.io]Client(${socket.id}) connected!`);
        console.debug(`[DEBUG] waitingStore is ${JSON.stringify(waitingStore)}`);

        // 待ち列が空でないことの確認
        if(waitingStore.length > 0){
            let gameId = waitingStore[0];
            console.debug(`[DEBUG] Current waitingGameId is ${gameId}`);
            if(gameStore[gameId] != null){
                let numOfUsers = gameStore[gameId].users.length;
                console.debug(`[DEBUG] ${gameStore[gameId].id} has ${numOfUsers} now.`);
                socket._gameId = gameId;
                gameStore[gameId].users.push(socket.id);
                // ユーザーはルームに参加済
                socket.join(socket._gameId);
                // 2人未満の場合待ち状態を維持・3人以上揃ったらゲーム開始
                if(2 <= numOfUsers){
                    console.debug(`[DEBUG] Game(${gameId}) has been started now.`);
                    // 3人以上揃ったので待ち列から削除
                    waitingStore.shift();
                    console.debug(`[DEBUG] Waiting games list is now ${JSON.stringify(waitingStore)}`);
                    // ゲーム開始のシグナルを送る
                    gameStore[gameId].isStarted = true;
                    io.to(socket._gameId).emit('start', {'n':numOfUsers + 1});
                    io.to(gameStore[gameId].users[0]).emit('turn');
                    // トークンの制限時間を15秒に設定
                    gameStore[gameId].tokenExpire = new Date(new Date().getTime() + 15*1000);
                    console.log(`[Socket.io]Game(${gameId}) started.`);
                }
                console.log(`Client(${socket.id}) joined the game ${gameId}`);
            }
        }else{
            // ルーム情報を初期化
            let gameInfo = {
                id: require('crypto').randomBytes(12).toString('hex'),
                users: [],
                cards: [],
                next: 0,
                tokenExpire: "",
                cardTmp: null,
                isStarted: false
            };
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
            // ゲームを待ち列に登録
            waitingStore.push(gameInfo.id);

            socket.join(socket._gameId);
            console.log(`Client(${socket.id}) joined the game ${socket._gameId}`);
        }

        // トリガー別の処理
        // カードの照合
        socket.on('cardOpen', (data) => {
            console.debug(`[DEBUG]Client(${socket.id}) opened a card(${data.cardPos}).`);
            const gameId = socket._gameId;
            const game = gameStore[gameId];
            // トークンを照合
            if(socket.id === game.users[game.next]){
                console.debug("[DEBUG]Client authorized.");
                let res;
                if(game.cardTmp != null){
                    // 2枚目の処理
                    console.debug("[DEBUG]Second card.");
                    let firstCard = game.cards[game.cardTmp];
                    let secondCard = game.cards[data.cardPos];
                    // 2つのカードが一致するかどうか
                    if(firstCard === secondCard && firstCard != null && secondCard != null){
                        // 一致したら加算
                        socket._score += 100;
                        // カード情報を削除
                        game.cards[game.cardTmp] = game.cards[data.cardPos] = null;
                        // 同じユーザーがもう一度プレイ
                        setTimeout(() => {io.to(socket.id).emit('turn');}, 1000);
                        console.debug("[DEBUG]Card hit!");
                    }else{
                        // 他のユーザーの番になる
                        if(game.users[game.next] !== null){
                            setTimeout(() => {io.to(game.users[game.next]).emit('turn');}, 1000);
                        }else{
                            setTimeout(() => {io.to(game.users[0]).emit('turn');}, 1000);
                        }
                        io.to(game.id).emit('reset');
                        console.debug(`[DEBUG]Client(${game.users[game.next]})'s turn.`);
                        if(game.next === (game.users.length - 1)){
                            game.next = 0;
                        }else{
                            game.next += 1;
                        }
                    }
                    // 初期化
                    game.cardTmp = null;
                    res = {
                        cards: [data.cardPos, game.cards[data.cardPos]]
                    };
                }else{
                    // 1枚目の処理
                    console.debug("[DEBUG]First card.");
                    game.cardTmp = data.cardPos;
                    res = {
                        cards: [data.cardPos, game.cards[data.cardPos]]
                    };
                }
                gameStore[gameId] = game;
                let isFinished = true;
                game.cards.some((v,i) => {
                    if(v !== null){
                        isFinished = false;
                    }
                });
                if(isFinished){
                    let results = [];
                    io.sockets.clients(gameId).forEach((client) => {
                        results.push(client.id);
                        results.push(client._score);
                    });
                    for (let i=1;i<(results.length/2)-1;i=2*i-1){
                        if(results[i] < results[i+2]){
                            let tmp = results[i+2];
                            results[i+2] = results[i];
                            results[i] = tmp;
                        }
                    }
                    for(let i=0;i<(results.length/2-1);i=2*i){
                        io.to(results[i]).emit('finish', {status: 'success', rank:i+1, score: results[i+1]});
                    }
                    delete gameStore[gameId];
                }else{
                    io.to(gameId).emit('cardRes', res);
                }
            }
        });

        // 切断時の処理
        socket.on('disconnect', () => {
            console.log(`[Socket.io]Client(${socket.id}) disconnected.`);
            const game = gameStore[socket._gameId];
            if(game != null){
                // 退出したユーザーが次のユーザーのとき
                if(game.users[game.next] === socket.id){
                    const nextUser = game.users[game.next + 1];
                    if(nextUser == null){
                        game.next = 0;
                    }else{
                        game.next += 1;
                    }
                }
                game.users.some((v, i) => {
                    if (v===socket.id) game.users.splice(i,1);
                });
                if(game.users.length <= 1){
                    io.to(game.id).emit('finish', {'status':'exception'});
                    waitingStore.some((v, i) => {
                        if (v===game.id) waitingStore.splice(i,1);
                    });
                    delete gameStore[game.id];
                }else{
                    gameStore[game.id] = game;
                }
            }
        });

        // 例外処理
        socket.on('error', (details) => {
            console.error(`[Socket.io]Error ${details}`);
        });
    });
}