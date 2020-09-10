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
console.log("Credentials have been loaded.");
const socket = io({
    query: {
        token: authToken
    }
});
socket.on("connect", () => {
    console.log("Connected to game server.");
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
let n = 0;
$('li.card').on('click', function(){
    let index = $('li.card').index(this);
    if(n === 0){
        $(this).id('firstSelected');
    }else if(n === 1){
        $(this).id('secondSelected');
    }
    if(n <= 1){
        let data = {
            token: authToken,
            cardPos: index
        }
        io.emit('cardOpen', data);
    }
    n++;
});
socket.on('turn', (data) => {
    $('#firstSelected').html(`<img src="images/card${data.cards[0]}">`);
    $('#secondSelected').html(`<img src="images/card${data.cards[1]}">`);
});