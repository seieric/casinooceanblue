//カードを表示
for (let i = 0; i < 20; i++){
    $("#gameField").append('<li class="card"><img src="images/card.jpg"></li>');
}
let cards = [];
for(let i=0;i<10;i++){
    cards[i] = cards[i+10] = i;
}
let tmp, n;
for(let i=0;i<20;i++){
    n = Math.floor(Math.random() * 20);
    tmp = cards[n];
    cards[n] = cards[i];
    cards[i] = tmp;
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
socket.on('finish', )
let numOfSelected = 0;
$('li.card').on('click', function(){
    let index = $('li.card').index(this);
    let n = cards[index] + 1;
    if(numOfSelected < 2){
        $(this).html(`<img src=images/card${n}.jpg>`);
    }
    console.log(index + 'th item clicked!');
    numOfSelected++;
});