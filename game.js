import {initializeApp} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {getFirestore,doc,setDoc,getDoc,updateDoc,onSnapshot} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig={
  apiKey:"AIzaSyD0Q5N2i4WRjJuRl1sa9gUJXvT0jy52Pzs",
  authDomain:"game-robney.firebaseapp.com",
  projectId:"game-robney",
  storageBucket:"game-robney.firebasestorage.app",
  messagingSenderId:"776079948578",
  appId:"1:776079948578:web:664781fb3c6d7db71cc37b"
};
const app=initializeApp(firebaseConfig),db=getFirestore(app);
const lobby=document.getElementById("lobby"),gameScreen=document.getElementById("gameScreen"),status=document.getElementById("status"),canvas=document.getElementById("gameCanvas"),ctx=canvas.getContext("2d");
let myName="",roomCode="",myPlayer=1,roomData=null,gameStarted=false,timeLeft=75,lastTime=Date.now(),gameOver=false,shake=0,hitStop=0;

function resizeCanvas(){const r=canvas.getBoundingClientRect();canvas.width=r.width*devicePixelRatio;canvas.height=r.height*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0)}
window.addEventListener("resize",resizeCanvas);

document.getElementById("createRoom").addEventListener("click",async()=>{
  const name=document.getElementById("playerName").value.trim();
  if(!name){status.textContent="Enter your fighter name.";return}
  myName=name;roomCode=Math.random().toString(36).substring(2,8).toUpperCase();myPlayer=1;
  try{
    await setDoc(doc(db,"rooms",roomCode),{
      host:myName,players:[myName],
      p1:{x:120,y:0,health:100,momentum:0,action:"idle"},
      p2:{x:0,y:0,health:100,momentum:0,action:"idle"},
      status:"waiting",timer:75,winner:null,lastExchange:0,createdAt:Date.now()
    });
    status.textContent="Room created: "+roomCode;openGame();
  }catch(e){console.error(e);status.textContent=e.message}
});

document.getElementById("joinRoom").addEventListener("click",async()=>{
  const name=document.getElementById("playerName").value.trim(),code=document.getElementById("roomCode").value.trim().toUpperCase();
  if(!name){status.textContent="Enter your fighter name.";return}
  if(!code){status.textContent="Enter room code.";return}
  try{
    const ref=doc(db,"rooms",code),snap=await getDoc(ref);
    if(!snap.exists()){status.textContent="Room not found.";return}
    const data=snap.data(),players=data.players||[];
    if(players.length>=2){status.textContent="Room is full.";return}
    if(players.includes(name)){status.textContent="That name is already in the room.";return}
    myName=name;roomCode=code;myPlayer=2;players.push(name);
    await updateDoc(ref,{players,status:"ready","p2.x":0,"p2.y":0,"p2.health":100,"p2.momentum":0,"p2.action":"idle"});
    openGame();
  }catch(e){console.error(e);status.textContent=e.message}
});

function openGame(){lobby.classList.add("hidden");gameScreen.classList.remove("hidden");resizeCanvas();startRoomListener();requestAnimationFrame(gameLoop)}

function startRoomListener(){
  onSnapshot(doc(db,"rooms",roomCode),snap=>{
    if(!snap.exists())return;
    roomData=snap.data();updateUI();
    if(roomData.status==="ready")gameStarted=true;
    if(roomData.winner)finishGame(roomData.winner);
  },e=>console.error(e));
}

function updateUI(){
  if(!roomData)return;
  const players=roomData.players||[],p1=roomData.p1||{},p2=roomData.p2||{};
  document.getElementById("p1Name").textContent=players[0]||"PLAYER 1";
  document.getElementById("p2Name").textContent=players[1]||"PLAYER 2";
  document.getElementById("p1Health").style.width=Math.max(0,p1.health||0)+"%";
  document.getElementById("p2Health").style.width=Math.max(0,p2.health||0)+"%";
  document.getElementById("p1Momentum").style.width=Math.min(100,p1.momentum||0)+"%";
  document.getElementById("p2Momentum").style.width=Math.min(100,p2.momentum||0)+"%";
  timeLeft=roomData.timer??75;
  document.getElementById("timer").textContent=Math.ceil(timeLeft);
}

async function move(dx){
  if(!roomData||gameOver)return;
  const key=myPlayer===1?"p1":"p2",p=roomData[key];if(!p)return;
  let x=(p.x||0)+dx;
  x=Math.max(20,Math.min(canvas.clientWidth-60,x));
  await updateDoc(doc(db,"rooms",roomCode),{[key+".x"]:x});
}

async function chooseMove(moveName){
  if(!roomData||gameOver||!gameStarted)return;
  const key=myPlayer===1?"p1":"p2",me=roomData[key];
  if(moveName==="overdrive"&&(!me||(me.momentum||0)<100)){showMessage("NEED 100 MOMENTUM");return}
  await updateDoc(doc(db,"rooms",roomCode),{[key+".action"]:moveName});
}

document.getElementById("left").addEventListener("pointerdown",()=>move(-30));
document.getElementById("right").addEventListener("pointerdown",()=>move(30));
document.getElementById("jump").addEventListener("pointerdown",()=>jump());
for(const id of ["light","heavy","grab","block","dash","overdrive"])document.getElementById(id).addEventListener("pointerdown",()=>chooseMove(id));

async function jump(){
  if(!roomData||gameOver)return;
  const key=myPlayer===1?"p1":"p2";
  await updateDoc(doc(db,"rooms",roomCode),{[key+".y"]:-80});
  setTimeout(()=>updateDoc(doc(db,"rooms",roomCode),{[key+".y"]:0}),450);
}

const counters={
  light:{beats:["grab"],damage:12},
  heavy:{beats:["light"],damage:25},
  grab:{beats:["block"],damage:20},
  block:{beats:["heavy"],damage:0},
  dash:{beats:["light","heavy","grab"],damage:0},
  overdrive:{beats:["light","heavy","grab","block"],damage:45}
};

async function resolveExchange(){
  if(!roomData||!gameStarted||gameOver||myPlayer!==1)return;
  const p1=roomData.p1,p2=roomData.p2;if(!p1||!p2)return;
  const a=p1.action,b=p2.action;
  if(!a||!b||a==="idle"||b==="idle")return;
  let damage1=0,damage2=0,momentum1=0,momentum2=0;
  if(a===b){
    if(["light","heavy","grab"].includes(a)){showMessage("CLASH!");triggerImpact()}
  }else if(counters[a]?.beats.includes(b)){
    damage2=counters[a].damage;momentum1=a==="overdrive"?0:15;showMessage(a.toUpperCase()+" PUNISH!");triggerImpact()
  }else if(counters[b]?.beats.includes(a)){
    damage1=counters[b].damage;momentum2=b==="overdrive"?0:15;showMessage(b.toUpperCase()+" PUNISH!");triggerImpact()
  }else{
    if(["light","heavy","grab"].includes(a)){damage2=counters[a].damage;momentum1=10}
    if(["light","heavy","grab"].includes(b)){damage1=counters[b].damage;momentum2=10}
  }
  if(a==="dash")damage2=0;
  if(b==="dash")damage1=0;
  if(a==="block"&&b!=="grab")damage1=0;
  if(b==="block"&&a!=="grab")damage2=0;
  if(a==="overdrive"){momentum1=-100}
  if(b==="overdrive"){momentum2=-100}
  const h1=Math.max(0,(p1.health||100)-damage1),h2=Math.max(0,(p2.health||100)-damage2);
  const m1=Math.min(100,Math.max(0,(p1.momentum||0)+momentum1)),m2=Math.min(100,Math.max(0,(p2.momentum||0)+momentum2));
  let winner=null;if(h1<=0&&h2<=0)winner="draw";else if(h1<=0)winner=2;else if(h2<=0)winner=1;
  await updateDoc(doc(db,"rooms",roomCode),{"p1.health":h1,"p2.health":h2,"p1.momentum":m1,"p2.momentum":m2,"p1.action":"idle","p2.action":"idle",winner});
}

function gameLoop(){
  if(hitStop>0)hitStop--;else{updateTimer();resolveExchange()}
  drawGame();requestAnimationFrame(gameLoop);
}

async function updateTimer(){
  if(!roomData||!gameStarted||gameOver||myPlayer!==1)return;
  const now=Date.now(),delta=(now-lastTime)/1000;lastTime=now;timeLeft=Math.max(0,timeLeft-delta);
  if(Math.floor(timeLeft)!==Math.floor(roomData.timer??75))await updateDoc(doc(db,"rooms",roomCode),{timer:timeLeft});
  if(timeLeft<=0){
    const h1=roomData.p1.health,h2=roomData.p2.health;let winner="draw";
    if(h1>h2)winner=1;if(h2>h1)winner=2;
    await updateDoc(doc(db,"rooms",roomCode),{winner});
  }
}

function drawGame(){
  const w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);if(!roomData)return;
  let sx=0,sy=0;if(shake>0){sx=(Math.random()-.5)*shake;sy=(Math.random()-.5)*shake;shake--}
  ctx.save();ctx.translate(sx,sy);
  const ground=h-70;ctx.fillStyle="#202938";ctx.fillRect(0,ground,w,70);ctx.fillStyle="#475569";ctx.fillRect(0,ground,w,4);
  drawFighter(roomData.p1,"#2563eb",ground);drawFighter(roomData.p2,"#dc2626",ground);ctx.restore();
}

function drawFighter(fighter,color,ground){
  if(!fighter)return;const x=fighter.x||0,y=fighter.y||0,baseY=ground+y;
  ctx.save();
  if((fighter.momentum||0)>=100){ctx.shadowBlur=25;ctx.shadowColor="#facc15"}
  ctx.fillStyle=color;
  ctx.fillRect(x+12,baseY-50,12,50);ctx.fillRect(x+34,baseY-50,12,50);
  ctx.fillRect(x+5,baseY-120,48,70);
  ctx.beginPath();ctx.arc(x+29,baseY-140,20,0,Math.PI*2);ctx.fill();
  if(fighter.action==="light"){ctx.fillStyle="#93c5fd";ctx.fillRect(x+50,baseY-105,55,12)}
  if(fighter.action==="heavy"){ctx.fillStyle="#fca5a5";ctx.fillRect(x+45,baseY-100,75,18)}
  if(fighter.action==="grab"){ctx.strokeStyle="#c4b5fd";ctx.lineWidth=8;ctx.beginPath();ctx.arc(x+60,baseY-100,35,-1,1);ctx.stroke()}
  if(fighter.action==="block"){ctx.strokeStyle="#e2e8f0";ctx.lineWidth=7;ctx.beginPath();ctx.arc(x+29,baseY-105,45,-1.5,1.5);ctx.stroke()}
  if(fighter.action==="overdrive"){ctx.strokeStyle="#facc15";ctx.lineWidth=8;ctx.beginPath();ctx.arc(x+29,baseY-100,75,0,Math.PI*2);ctx.stroke()}
  ctx.restore();
}

function triggerImpact(){hitStop=8;shake=15;const m=document.getElementById("message");m.classList.remove("hit");void m.offsetWidth;m.classList.add("hit")}
function showMessage(t){const m=document.getElementById("message");m.textContent=t;setTimeout(()=>{if(m.textContent===t)m.textContent=""},700)}

function finishGame(winner){
  if(gameOver)return;gameOver=true;
  if(winner==="draw"){showMessage("DRAW!");return}
  const name=winner===1?roomData.players[0]:roomData.players[1];showMessage(name+" WINS!");
  setTimeout(()=>showMessage("☠️ FATALITY ☠️"),1000);
  setTimeout(restartRound,3500);
}

async function restartRound(){
  if(myPlayer!==1)return;
  await updateDoc(doc(db,"rooms",roomCode),{
    "p1.health":100,"p2.health":100,"p1.momentum":0,"p2.momentum":0,
    "p1.x":120,"p2.x":Math.max(220,canvas.clientWidth-180),
    "p1.y":0,"p2.y":0,"p1.action":"idle","p2.action":"idle",
    timer:75,winner:null,status:"ready"
  });
  timeLeft=75;lastTime=Date.now();gameOver=false;showMessage("FIGHT!");
}

document.addEventListener("keydown",e=>{
  if(e.key==="ArrowLeft")move(-30);if(e.key==="ArrowRight")move(30);
  if(e.key==="a")chooseMove("light");if(e.key==="s")chooseMove("heavy");
  if(e.key==="d")chooseMove("grab");if(e.key==="f")chooseMove("block");
  if(e.key==="g")chooseMove("dash");if(e.key==="h")chooseMove("overdrive");
});
