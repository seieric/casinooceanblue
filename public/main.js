//セッションからトークンとプレイヤー名を取得
let playerName = localStorage.getItem('playerName');
let authToken = localStorage.getItem('authToken');
if(playerName == null || playerName === "" || authToken == null || authToken === ""){
    window.location.replace("start.html");
}
// サーバー接続処理
$("#loaderMsg").text("サーバーに接続しています...");
const socket = io({
    transports: ['websocket'],
    query: {
        token: authToken
    }
});
// カード情報保存
let cards = [];
let previous = {value: -1, pos: -1};
// サーバーに接続成功時
socket.on("connect", () => {
    $("#loaderMsg").text("他のプレイヤーの参加を待っています...時間がかかることがあります。");
    console.log("Connected to game server.");
});
// カードの中身が送られてきたとき
socket.on('cardRes', (data) => {
    console.log("Response received.");
    if(data.cards[1] !== null){
        $('li.card').eq(data.cards[0]).html(`<img src="images/card${data.cards[1]}.jpg">`);
        if(previous.value === data.cards[1]){
            setTimeout(() => {
                $('li.card').eq(previous.pos).html(`<img src="images/opend.jpg">`);
                $('li.card').eq(data.cards[0]).html(`<img src="images/opend.jpg">`);
                $('li.card').eq(previous.pos).addClass('card-opend');
                $('li.card').eq(data.cards[0]).addClass('card-opend');
            }, 2000);
            // reset
            previous.value = previous.pos = -1;
        }else if(previous.pos === -1){
            previous.pos = data.cards[0];
            previous.value = data.cards[1];
        }
    }
});
// 自分の番が回ってきたとき
socket.on('turn', (data) => {
    console.log('Now, your turn.');
    $("#turnDisplay").text("あなたの番です。");
    const token = data.token;
    let count = 15;
    const expire = new Date(new Date().getTime() + count * 1000);
    const counter = setInterval(() => {
        count--;
        $('#counter').text(`制限時間${count}秒`);
        if(new Date().getTime() >= expire.getTime()){
            clearInterval(counter);
            $("#turnDisplay").text("他の人の番になりました。");
            $("#counter").text("");
        }
    }, 1000);
    $('li.card').on('click', function(){
        if(token != null){
            const index = $('li.card').index(this);
            cards.push(index);
            if(cards.length <= 2){
                let data = {
                    token: token,
                    cardPos: index
                }
                socket.emit('cardOpen', data);
            }
            if(cards.length === 2){
                $('li.card').off();
                cards = [];
                clearInterval(counter);
                $('#counter').text("");
                $("#turnDisplay").text("他の人の番になりました。");
            }
        }
    });
});
// 開始処理
socket.on('start', (data) => {
    for (let i = 0; i < 20; i++){
        $("#gameField").append('<li class="card"><img src="images/card.jpg"></li>');
    }
    $("#loaderMsg").text("ゲームが開始されました...");
    $("#loaderWrap").remove();
    $("body").css('background', '#fff');
    $("#game").css('visibility', 'visible');
    console.log("Game started.");
});
// 終了処理
socket.on('finish', (data) => {
    $("#turnDisplay").text("Finished!!");
    $("#counter").text("");
    console.log("Finished!")
    let result;
    if(data.status === 'exception'){
        result = {
            status: "exception"
        };
        alert("他のプレイヤーが退出したか、エラーが起きました。");
    }else{
        result = {
            status: "success",
            score: data.score,
            rank: data.rank
        }
    }
    sessionStorage.setItem('result', JSON.stringify(result));
    location.replace("result.html");
});