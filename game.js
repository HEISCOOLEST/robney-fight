import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:"AIzaSyD0Q5N2i4WRjJuRl1sa9gUJXvT0jy52Pzs",
  authDomain:"game-robney.firebaseapp.com",
  projectId:"game-robney",
  storageBucket:"game-robney.firebasestorage.app",
  messagingSenderId:"776079948578",
  appId:"1:776079948578:web:664781fb3c6d7db71cc37b"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const lobby = document.getElementById("lobby");
const gameScreen = document.getElementById("gameScreen");
const status = document.getElementById("status");
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

let myName="", roomCode="", myPlayer=1;
let roomData=null, gameStarted=false, gameOver=false;
let timerLoop=null, exchangeLoop=null, animationStarted=false;
let shake=0, hitStop=0, resolving=false;

function resizeCanvas(){
  const r=canvas.getBoundingClientRect();
  canvas.width=r.width*devicePixelRatio;
  canvas.height=r.height*devicePixelRatio;
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
}
window.addEventListener("resize",resizeCanvas);

window.addEventListener("DOMContentLoaded",()=>{
  const lastName=localStorage.getItem("robneyFightLastName");
  const lastRoom=localStorage.getItem("robneyFightLastRoom");
  if(lastName) document.getElementById("playerName").value=lastName;
  if(lastRoom) document.getElementById("roomCode").value=lastRoom;
});

document.getElementById("createRoom").addEventListener("click",async()=>{
  const name=document.getElementById("playerName").value.trim();
  if(!name){status.textContent="Enter your fighter name.";return;}
  myName=name;
  roomCode=Math.random().toString(36).substring(2,8).toUpperCase();
  myPlayer=1;
  try{
    await setDoc(doc(db,"rooms",roomCode),{
      host:name,
      players:[name],
      p1:{x:80,y:0,health:100,momentum:0,action:"idle"},
      p2:{x:280,y:0,health:100,momentum:0,action:"idle"},
      status:"waiting",
      timer:75,
      winner:null,
      createdAt:Date.now()
    });
    openGame();
  }catch(e){status.textContent=e.message;}
});

document.getElementById("joinRoom").addEventListener("click",async()=>{
  const name=document.getElementById("playerName").value.trim();
  const code=document.getElementById("roomCode").value.trim().toUpperCase();
  if(!name||!code){status.textContent="Enter name and room code.";return;}
  try{
    const ref=doc(db,"rooms",code);
    const snap=await getDoc(ref);
    if(!snap.exists()){status.textContent="Room not found.";return;}
    const data=snap.data();
    const players=data.players||[];

    // Reconnect: if this name already belongs to player 1 or 2,
    // let the player back into the same room instead of saying "Room is full".
    const existingIndex=players.findIndex(p=>p===name);

    if(existingIndex===0){
      myName=name; roomCode=code; myPlayer=1;
      await updateDoc(ref,{
        status: players.length>=2 ? "ready" : "waiting",
        "p1.action":"idle"
      });
      openGame();
      return;
    }

    if(existingIndex===1){
      myName=name; roomCode=code; myPlayer=2;
      await updateDoc(ref,{
        status: players.length>=2 ? "ready" : "waiting",
        "p2.action":"idle"
      });
      openGame();
      return;
    }

    if(players.length>=2){
      status.textContent="Room is full. Use the name you used before to reconnect.";
      return;
    }

    players.push(name);
    myName=name; roomCode=code; myPlayer=2;
    await updateDoc(ref,{
      players:players,
      status:"ready",
      "p2.x":Math.max(220,window.innerWidth-130),
      "p2.y":0,
      "p2.health":100,
      "p2.momentum":0,
      "p2.action":"idle"
    });
    openGame();
  }catch(e){status.textContent=e.message;}
});

function openGame(){
  localStorage.setItem("robneyFightLastRoom",roomCode);
  localStorage.setItem("robneyFightLastName",myName);
  localStorage.setItem("robneyFightLastPlayer",String(myPlayer));
  lobby.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  document.getElementById("liveRoomCode").textContent=roomCode;
  resizeCanvas();
  startListener();
  if(!animationStarted){animationStarted=true;requestAnimationFrame(gameLoop);}
}

document.getElementById("copyRoom").addEventListener("click",async()=>{
  try{
    await navigator.clipboard.writeText(roomCode);
    const b=document.getElementById("copyRoom");
    b.textContent="COPIED!";
    setTimeout(()=>b.textContent="COPY",1200);
  }catch{
    showMessage(roomCode);
  }
});

function startListener(){
  onSnapshot(doc(db,"rooms",roomCode),snap=>{
    if(!snap.exists()) return;
    roomData=snap.data();
    updateUI();

    const count=(roomData.players||[]).length;
    if(roomData.status==="ready" && count===2){
      gameStarted=true;
      if(myPlayer===1) startHostLoops();
    }

    if(roomData.winner!==null && roomData.winner!==undefined){
      finishGame(roomData.winner);
    }else if(gameOver){
      gameOver=false;
      showMessage("FIGHT!");
    }
  });
}

function startHostLoops(){
  if(timerLoop===null){
    timerLoop=setInterval(hostTick,1000);
  }
  if(exchangeLoop===null){
    exchangeLoop=setInterval(resolveExchange,120);
  }
}

async function hostTick(){
  if(myPlayer!==1||!roomData||!gameStarted||gameOver) return;
  const t=Math.max(0,Math.ceil((roomData.timer??75)-1));
  if(t<=0){
    const h1=roomData.p1.health, h2=roomData.p2.health;
    let winner="draw";
    if(h1>h2) winner=1;
    if(h2>h1) winner=2;
    await updateDoc(doc(db,"rooms",roomCode),{timer:0,winner});
  }else{
    await updateDoc(doc(db,"rooms",roomCode),{timer:t});
  }
}

function updateUI(){
  if(!roomData) return;
  const p1=roomData.p1||{}, p2=roomData.p2||{}, players=roomData.players||[];
  document.getElementById("p1Name").textContent=players[0]||"PLAYER 1";
  document.getElementById("p2Name").textContent=players[1]||"PLAYER 2";
  document.getElementById("p1Health").style.width=(p1.health??100)+"%";
  document.getElementById("p2Health").style.width=(p2.health??100)+"%";
  document.getElementById("p1Momentum").style.width=(p1.momentum??0)+"%";
  document.getElementById("p2Momentum").style.width=(p2.momentum??0)+"%";
  document.getElementById("timer").textContent=roomData.timer??75;
}

async function move(dx){
  if(!roomData||gameOver||!gameStarted) return;
  const key=myPlayer===1?"p1":"p2";
  const current=roomData[key];
  if(!current) return;
  const maxX=Math.max(20,canvas.clientWidth-60);
  const next=Math.max(20,Math.min(maxX,(current.x??80)+dx));
  await updateDoc(doc(db,"rooms",roomCode),{[key+".x"]:next});
}

async function jump(){
  if(!roomData||gameOver||!gameStarted) return;
  const key=myPlayer===1?"p1":"p2";
  await updateDoc(doc(db,"rooms",roomCode),{[key+".y"]:-70});
  setTimeout(()=>updateDoc(doc(db,"rooms",roomCode),{[key+".y"]:0}),320);
}

async function chooseMove(move){
  if(!roomData||gameOver||!gameStarted) return;
  const key=myPlayer===1?"p1":"p2";
  const me=roomData[key];
  if(move==="overdrive" && (me.momentum??0)<100){
    showMessage("NEED 100 MOMENTUM");
    return;
  }
  await updateDoc(doc(db,"rooms",roomCode),{[key+".action"]:move});
}

for(const [id,fn] of [
  ["left",()=>move(-24)],["right",()=>move(24)],["jump",jump],
  ["light",()=>chooseMove("light")],["heavy",()=>chooseMove("heavy")],
  ["grab",()=>chooseMove("grab")],["block",()=>chooseMove("block")],
  ["dash",()=>chooseMove("dash")],["overdrive",()=>chooseMove("overdrive")]
]){
  document.getElementById(id).addEventListener("pointerdown",fn);
}

const beats={
  light:["grab"],
  heavy:["light"],
  grab:["block"],
  block:["heavy"],
  dash:["light","heavy","grab"],
  overdrive:["light","heavy","grab","block"]
};
const damage={light:12,heavy:24,grab:18,block:0,dash:0,overdrive:42};

async function resolveExchange(){
  if(resolving||myPlayer!==1||!roomData||!gameStarted||gameOver) return;
  const a=roomData.p1.action, b=roomData.p2.action;
  if(!a||!b||a==="idle"||b==="idle") return;
  resolving=true;

  const p1=roomData.p1, p2=roomData.p2;
  let d1=0,d2=0,m1=0,m2=0;

  if(a===b){
    if(["light","heavy","grab"].includes(a)){showMessage("CLASH!");impact();}
  }else if(beats[a].includes(b)){
    d2=damage[a]; m1=a==="overdrive"?-100:15;
    showMessage(a.toUpperCase()+" PUNISH!"); impact();
  }else if(beats[b].includes(a)){
    d1=damage[b]; m2=b==="overdrive"?-100:15;
    showMessage(b.toUpperCase()+" PUNISH!"); impact();
  }else{
    if(["light","heavy","grab","overdrive"].includes(a)){d2=damage[a];m1=a==="overdrive"?-100:10;}
    if(["light","heavy","grab","overdrive"].includes(b)){d1=damage[b];m2=b==="overdrive"?-100:10;}
  }

  if(a==="dash") d1=0;
  if(b==="dash") d2=0;
  if(a==="block" && b!=="grab") d1=0;
  if(b==="block" && a!=="grab") d2=0;

  const h1=Math.max(0,p1.health-d1), h2=Math.max(0,p2.health-d2);
  const mm1=Math.max(0,Math.min(100,p1.momentum+m1));
  const mm2=Math.max(0,Math.min(100,p2.momentum+m2));

  let winner=null;
  if(h1<=0&&h2<=0) winner="draw";
  else if(h1<=0) winner=2;
  else if(h2<=0) winner=1;

  await updateDoc(doc(db,"rooms",roomCode),{
    "p1.health":h1,"p2.health":h2,
    "p1.momentum":mm1,"p2.momentum":mm2,
    "p1.action":"idle","p2.action":"idle",
    winner
  });
  resolving=false;
}

function gameLoop(){
  drawGame();
  requestAnimationFrame(gameLoop);
}

function drawGame(){
  const w=canvas.clientWidth,h=canvas.clientHeight;
  ctx.clearRect(0,0,w,h);
  if(!roomData) return;
  let sx=0,sy=0;
  if(shake>0){sx=(Math.random()-.5)*shake;sy=(Math.random()-.5)*shake;shake--;}
  ctx.save();ctx.translate(sx,sy);
  const ground=h-70;
  ctx.fillStyle="#202938";ctx.fillRect(0,ground,w,70);
  ctx.fillStyle="#475569";ctx.fillRect(0,ground,w,4);
  drawFighter(roomData.p1,"#2563eb",ground);
  drawFighter(roomData.p2,"#ef2222",ground);
  ctx.restore();
}

function drawFighter(f,color,ground){
  if(!f) return;
  const x=f.x??0, base=ground+(f.y??0);
  ctx.save();
  if((f.momentum??0)>=100){ctx.shadowBlur=24;ctx.shadowColor="#facc15";}
  ctx.fillStyle=color;
  ctx.fillRect(x+12,base-50,12,50);
  ctx.fillRect(x+34,base-50,12,50);
  ctx.fillRect(x+5,base-120,48,70);
  ctx.beginPath();ctx.arc(x+29,base-140,20,0,Math.PI*2);ctx.fill();

  if(f.action==="light"){ctx.fillStyle="#bfdbfe";ctx.fillRect(x+48,base-105,55,10);}
  if(f.action==="heavy"){ctx.fillStyle="#fecaca";ctx.fillRect(x+45,base-100,78,16);}
  if(f.action==="grab"){ctx.strokeStyle="#ddd6fe";ctx.lineWidth=7;ctx.beginPath();ctx.arc(x+60,base-98,34,-1,1);ctx.stroke();}
  if(f.action==="block"){ctx.strokeStyle="#e5e7eb";ctx.lineWidth=6;ctx.beginPath();ctx.arc(x+29,base-104,42,-1.5,1.5);ctx.stroke();}
  if(f.action==="dash"){ctx.globalAlpha=.35;ctx.fillStyle=color;ctx.fillRect(x-22,base-120,30,70);}
  if(f.action==="overdrive"){ctx.strokeStyle="#fde047";ctx.lineWidth=8;ctx.beginPath();ctx.arc(x+29,base-100,70,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
}

function impact(){
  hitStop=8; shake=12;
}

function showMessage(text){
  const m=document.getElementById("message");
  m.textContent=text;
  setTimeout(()=>{if(m.textContent===text)m.textContent="";},700);
}

function finishGame(winner){
  if(gameOver) return;
  gameOver=true;
  if(winner==="draw"){showMessage("DRAW!");return;}
  const n=winner===1?roomData.players[0]:roomData.players[1];
  showMessage(n+" WINS!");
  setTimeout(()=>showMessage("☠️ FATALITY ☠️"),900);
  setTimeout(restartRound,3200);
}

async function restartRound(){
  if(myPlayer!==1) return;
  const right=Math.max(220,canvas.clientWidth-100);
  await updateDoc(doc(db,"rooms",roomCode),{
    "p1.health":100,"p2.health":100,
    "p1.momentum":0,"p2.momentum":0,
    "p1.x":80,"p2.x":right,
    "p1.y":0,"p2.y":0,
    "p1.action":"idle","p2.action":"idle",
    timer:75,winner:null,status:"ready"
  });
  gameOver=false;
}

document.addEventListener("keydown",e=>{
  if(e.key==="ArrowLeft")move(-24);
  if(e.key==="ArrowRight")move(24);
  if(e.key==="a")chooseMove("light");
  if(e.key==="s")chooseMove("heavy");
  if(e.key==="d")chooseMove("grab");
  if(e.key==="f")chooseMove("block");
  if(e.key==="g")chooseMove("dash");
  if(e.key==="h")chooseMove("overdrive");
});
