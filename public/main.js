//カードを表示
for (let i = 0; i < 20; i++){
    $("#gameField").append('<li class="card"><img src="images/card.jpg"></li>');
}
//セッションからトークンとプレイヤー名を取得
let playerName = localStorage.getItem('playerName');
let authToken = localStorage.getItem('authToken');
if(playerName == null || playerName === "" || authToken == null || authToken === ""){
    window.location.href="start.html";
}
$("#loaderMsg").text("サーバーに接続しています...");
const socket = io({
    transports: ['websocket'],
    query: {
        token: authToken
    }
});
socket.on("connect", () => {
    $("#loaderMsg").text("他のプレイヤーの参加を待っています...時間がかかることがあります。");
    console.log("Connected to game server.");
});
let isStarted = false;
let n = 0;
$('li.card').on('click', function(){
    let token = sessionStorage.getItem('cardToken');
    if(isStarted && token != null){
        let index = $('li.card').index(this);
        if(n === 0){
            $(this).attr('id', 'firstSelected');
        }else if(n === 1){
            $(this).attr('id', 'secondSelected');
        }
        if(n <= 1){
            let data = {
                token: token,
                cardPos: index
            }
            socket.emit('cardOpen', data);
            console.log("SEND REQ");
        }
        n++;
    }
});
// カードの中身が送られてきたとき
socket.on('cardRes', (data) => {
    console.log("RECEIVE RES");
    $('#firstSelected').html(`<img src="images/card${data.cards[0]}.jpg">`);
    $('#secondSelected').html(`<img src="images/card${data.cards[1]}.jpg">`);
});
// 自分の番が回ってきたとき
socket.on('turn', (data) => {
   console.log("Now, your turn.");
   sessionStorage.setItem('cardToken', data.token);
   setTimeout(() => {
       sessionStorage.removeItem('cardToken');
       console.log("時間切れです。");
   }, 10000);
});
socket.on('start', (data) => {
    $("#loaderMsg").text("ゲームが開始されました...");
    $("#loaderWrap").css('visibility', 'hidden');
    $("body").css('background', '#fff');
    $("#game").css('visibility', 'visible');
   console.log("Game started.");
   console.log(`${data.n} people in the game.`);
   isStarted = true;
});
socket.on('finish', (data) => {
    let result;
    if(data.status === 'exception'){
        result = {
            status: "exception"
        };
    }else{
        result = {
            status: "success",
            score: data.score,
            rank: data.rank
        }
    }
    sessionStorage.setItem('result', JSON.stringify(result));
});