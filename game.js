import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig={apiKey:"AIzaSyD0Q0N2i4WRjJuRl1sa9gUJXvT0jy52Pzs",authDomain:"game-robney.firebaseapp.com",projectId:"game-robney",storageBucket:"game-robney.firebasestorage.app",messagingSenderId:"776079948578",appId:"1:776079948578:web:664781fb3c6d7db71cc37b"};
const app=initializeApp(firebaseConfig); const db=getFirestore(app);

const lobby=document.getElementById("lobby"),gameScreen=document.getElementById("gameScreen"),status=document.getElementById("status"),
  canvas=document.getElementById("gameCanvas"),ctx=canvas.getContext("2d"),rotatePrompt=document.getElementById("rotatePrompt"),
  comboFxEl=document.getElementById("comboFx");

let myName="",roomCode="",myPlayer=1,roomData=null,gameStarted=false,gameOver=false,animationStarted=false,timerLoop=null,combatLoop=null;
let shake=0,localFx="",localFxUntil=0;

// Logical arena is a fixed size so both devices agree on positions/ranges regardless of screen width.
const ARENA_W=960,FIGHTER_W=58;

const ATTACKS={
 light:{damage:9,range:118,windup:110,recovery:190,beats:["grab"],gain:12},
 heavy:{damage:20,range:128,windup:260,recovery:360,beats:["light"],gain:18},
 grab:{damage:15,range:92,windup:150,recovery:320,beats:["block"],gain:16},
 overdrive:{damage:38,range:148,windup:220,recovery:540,beats:["light","heavy","grab","block"],gain:-100},
 fatality:{damage:100,range:108,windup:140,recovery:900,beats:["block"],gain:-100}
};
const now=()=>Date.now();
const clampX=x=>Math.max(20,Math.min(ARENA_W-FIGHTER_W-20,x));

/* ---------------- orientation ---------------- */
function checkOrientation(){
  const needsLandscape=!gameScreen.classList.contains("hidden");
  const isPortrait=innerHeight>innerWidth;
  rotatePrompt.classList.toggle("hidden",!(needsLandscape&&isPortrait));
}
addEventListener("resize",()=>{resizeCanvas();checkOrientation()});
addEventListener("orientationchange",()=>{setTimeout(()=>{resizeCanvas();checkOrientation()},60)});
async function tryLockLandscape(){try{if(screen.orientation&&screen.orientation.lock)await screen.orientation.lock("landscape")}catch{}}

function resizeCanvas(){const r=canvas.getBoundingClientRect();canvas.width=r.width*devicePixelRatio;canvas.height=r.height*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0)}
addEventListener("DOMContentLoaded",()=>{const n=localStorage.getItem("robneyFightLastName"),r=localStorage.getItem("robneyFightLastRoom");if(n)document.getElementById("playerName").value=n;if(r)document.getElementById("roomCode").value=r});

/* ---------------- lobby ---------------- */
document.getElementById("createRoom").onclick=async()=>{const name=document.getElementById("playerName").value.trim();if(!name){status.textContent="Enter your fighter name.";return}myName=name;roomCode=Math.random().toString(36).substring(2,8).toUpperCase();myPlayer=1;try{await setDoc(doc(db,"rooms",roomCode),{host:name,players:[name],p1:baseP(90),p2:baseP(ARENA_W-90-FIGHTER_W),status:"waiting",timer:75,winner:null,createdAt:now()});openGame()}catch(e){status.textContent=e.message}};

document.getElementById("joinRoom").onclick=async()=>{const name=document.getElementById("playerName").value.trim(),code=document.getElementById("roomCode").value.trim().toUpperCase();if(!name||!code){status.textContent="Enter name and room code.";return}try{const ref=doc(db,"rooms",code),snap=await getDoc(ref);if(!snap.exists()){status.textContent="Room not found.";return}const data=snap.data(),players=data.players||[],existing=players.findIndex(x=>x===name);if(existing===0||existing===1){myName=name;roomCode=code;myPlayer=existing+1;await updateDoc(ref,{status:players.length>=2?"ready":"waiting",["p"+myPlayer+".action"]:"idle"});openGame();return}if(players.length>=2){status.textContent="Room is full. Use the name you used before to reconnect.";return}players.push(name);myName=name;roomCode=code;myPlayer=2;await updateDoc(ref,{players,status:"ready","p2.x":ARENA_W-90-FIGHTER_W,"p2.y":0,"p2.action":"idle"});openGame()}catch(e){status.textContent=e.message}};

function baseP(x){return{x,y:0,health:100,momentum:0,action:"idle",actionAt:0,lockedUntil:0,invulnUntil:0,hitstunUntil:0,combo:0}}
function openGame(){localStorage.setItem("robneyFightLastRoom",roomCode);localStorage.setItem("robneyFightLastName",myName);localStorage.setItem("robneyFightLastPlayer",String(myPlayer));lobby.classList.add("hidden");gameScreen.classList.remove("hidden");document.getElementById("liveRoomCode").textContent=roomCode;tryLockLandscape();checkOrientation();resizeCanvas();startListener();if(!animationStarted){animationStarted=true;requestAnimationFrame(gameLoop)}}

document.getElementById("copyRoom").onclick=async()=>{try{await navigator.clipboard.writeText(roomCode);const b=document.getElementById("copyRoom");b.textContent="COPIED!";setTimeout(()=>b.textContent="COPY",1200)}catch{showMessage(roomCode)}};

function startListener(){onSnapshot(doc(db,"rooms",roomCode),snap=>{if(!snap.exists())return;roomData=snap.data();updateUI();if(roomData.status==="ready"&&(roomData.players||[]).length===2){gameStarted=true;if(myPlayer===1)startHostLoops()}if(roomData.winner!==null&&roomData.winner!==undefined)finishGame(roomData.winner)})}
function startHostLoops(){if(!timerLoop)timerLoop=setInterval(hostTick,1000);if(!combatLoop)combatLoop=setInterval(hostCombat,45)}
async function hostTick(){if(myPlayer!==1||!roomData||!gameStarted||gameOver)return;const t=Math.max(0,(roomData.timer??75)-1);if(t<=0){const h1=roomData.p1.health,h2=roomData.p2.health;await updateDoc(doc(db,"rooms",roomCode),{timer:0,winner:h1===h2?"draw":h1>h2?1:2})}else await updateDoc(doc(db,"rooms",roomCode),{timer:t})}

/* ---------------- HUD ---------------- */
let prevCombo={p1:0,p2:0};
function updateUI(){
  if(!roomData)return;
  const p1=roomData.p1||{},p2=roomData.p2||{},players=roomData.players||[];
  document.getElementById("p1Name").textContent=players[0]||"PLAYER 1";
  document.getElementById("p2Name").textContent=players[1]||"PLAYER 2";
  document.getElementById("p1Health").style.width=Math.max(0,p1.health??100)+"%";
  document.getElementById("p2Health").style.width=Math.max(0,p2.health??100)+"%";
  document.getElementById("p1Momentum").style.width=Math.max(0,p1.momentum??0)+"%";
  document.getElementById("p2Momentum").style.width=Math.max(0,p2.momentum??0)+"%";
  document.getElementById("p1MomentumWrap").classList.toggle("full",(p1.momentum??0)>=100);
  document.getElementById("p2MomentumWrap").classList.toggle("full",(p2.momentum??0)>=100);
  document.getElementById("timer").textContent=roomData.timer??75;

  const me=myPlayer===1?p1:p2,enemy=myPlayer===1?p2:p1;
  document.getElementById("fatality").classList.toggle("ready",(enemy.health??100)<=20&&distance(me,enemy)<=120&&!gameOver);
  document.getElementById("overdrive").classList.toggle("ready",(me.momentum??0)>=100&&!gameOver);

  if((p1.combo||0)>1&&p1.combo!==prevCombo.p1)showCombo(p1.combo,"var(--p1-glow)");
  if((p2.combo||0)>1&&p2.combo!==prevCombo.p2)showCombo(p2.combo,"var(--p2-glow)");
  prevCombo={p1:p1.combo||0,p2:p2.combo||0};
}
function showCombo(n,color){comboFxEl.textContent=n+" HIT COMBO";comboFxEl.style.color=color;comboFxEl.classList.remove("show");void comboFxEl.offsetWidth;comboFxEl.classList.add("show")}
function distance(a,b){return Math.abs((a?.x??0)-(b?.x??0))}

/* ---------------- player actions ---------------- */
async function move(dx){if(!roomData||gameOver||!gameStarted)return;const key="p"+myPlayer,me=roomData[key],t=now();if((me.lockedUntil||0)>t)return;const next=clampX((me.x??80)+dx);await updateDoc(doc(db,"rooms",roomCode),{[key+".x"]:next,[key+".action"]:"idle",[key+".actionAt"]:0})}
async function jump(){if(!roomData||gameOver||!gameStarted)return;const key="p"+myPlayer,me=roomData[key],t=now();if((me.lockedUntil||0)>t)return;await updateDoc(doc(db,"rooms",roomCode),{[key+".y"]:-70,[key+".lockedUntil"]:t+320});setTimeout(()=>updateDoc(doc(db,"rooms",roomCode),{[key+".y"]:0,[key+".lockedUntil"]:0}).catch(()=>{}),320)}
async function chooseDash(){if(!roomData||gameOver||!gameStarted)return;const key="p"+myPlayer,enemyKey=myPlayer===1?"p2":"p1",me=roomData[key],enemy=roomData[enemyKey],t=now();if((me.lockedUntil||0)>t)return;const dir=(me.x??0)<=(enemy.x??0)?-1:1,dur=260,next=clampX((me.x??0)+dir*115);await updateDoc(doc(db,"rooms",roomCode),{[key+".action"]:"dash",[key+".actionAt"]:t,[key+".x"]:next,[key+".invulnUntil"]:t+dur,[key+".lockedUntil"]:t+dur});setTimeout(()=>updateDoc(doc(db,"rooms",roomCode),{[key+".action"]:"idle"}).catch(()=>{}),dur)}
async function chooseMove(mv){if(!roomData||gameOver||!gameStarted)return;const key="p"+myPlayer,me=roomData[key],t=now();if((me.lockedUntil||0)>t)return;if(mv==="overdrive"&&(me.momentum??0)<100){showMessage("NEED 100 MOMENTUM");return}if(mv==="fatality"){const enemy=roomData[myPlayer===1?"p2":"p1"];if((enemy.health??100)>20||distance(me,enemy)>120){showMessage("GET CLOSE • ENEMY ≤20 HP");return}}const def=ATTACKS[mv];if(!def)return;await updateDoc(doc(db,"rooms",roomCode),{[key+".action"]:mv,[key+".actionAt"]:t,[key+".lockedUntil"]:t+def.recovery})}
async function chooseBlock(active){const key="p"+myPlayer;if(!roomData||gameOver||!gameStarted)return;const t=now();if(active)await updateDoc(doc(db,"rooms",roomCode),{[key+".action"]:"block",[key+".actionAt"]:t,[key+".lockedUntil"]:t+180});else await updateDoc(doc(db,"rooms",roomCode),{[key+".action"]:"idle",[key+".actionAt"]:0,[key+".lockedUntil"]:0})}

let moveHold=null;
function bindHold(id,fn){const el=document.getElementById(id);if(!el)return;el.addEventListener("pointerdown",e=>{e.preventDefault();fn();if(id==="left"||id==="right"){clearInterval(moveHold);moveHold=setInterval(fn,90)}});["pointerup","pointercancel","pointerleave"].forEach(ev=>el.addEventListener(ev,()=>{if(id==="left"||id==="right"){clearInterval(moveHold);moveHold=null}}))}
bindHold("left",()=>move(-35)); bindHold("right",()=>move(35));
document.getElementById("jump")?.addEventListener("pointerdown",e=>{e.preventDefault();jump()});
document.getElementById("dash")?.addEventListener("pointerdown",e=>{e.preventDefault();chooseDash()});
for(const [id,fn] of [["light",()=>chooseMove("light")],["heavy",()=>chooseMove("heavy")],["grab",()=>chooseMove("grab")],["overdrive",()=>chooseMove("overdrive")],["fatality",()=>chooseMove("fatality")]])document.getElementById(id)?.addEventListener("pointerdown",e=>{e.preventDefault();fn()});
const blockBtn=document.getElementById("block");blockBtn.addEventListener("pointerdown",e=>{e.preventDefault();chooseBlock(true)});blockBtn.addEventListener("pointerup",()=>chooseBlock(false));blockBtn.addEventListener("pointercancel",()=>chooseBlock(false));

addEventListener("keydown",e=>{if(e.repeat)return;if(e.key==="ArrowLeft")move(-35);if(e.key==="ArrowRight")move(35);if(e.key==="ArrowUp")jump();if(e.key==="a")chooseMove("light");if(e.key==="s")chooseMove("heavy");if(e.key==="d")chooseMove("grab");if(e.key==="f")chooseBlock(true);if(e.key==="g")chooseDash();if(e.key==="h")chooseMove("overdrive");if(e.key==="j")chooseMove("fatality")});
addEventListener("keyup",e=>{if(e.key==="f")chooseBlock(false)});

/* ---------------- host-authoritative combat ---------------- */
let pendingAtk={p1:null,p2:null};
async function hostCombat(){
  if(myPlayer!==1||!roomData||!gameStarted||gameOver)return;
  const t=now();
  const P={p1:{...roomData.p1},p2:{...roomData.p2}};
  let changed=false;

  for(const k of ["p1","p2"]){
    const me=P[k],action=me.action,at=me.actionAt||0;
    if(!action||action==="idle"||action==="block"||action==="dash"){pendingAtk[k]=null;continue}
    if(!ATTACKS[action])continue;
    if(!pendingAtk[k]||pendingAtk[k].at!==at)pendingAtk[k]={action,at,resolveTime:at+ATTACKS[action].windup,done:false};
  }

  for(const attackerKey of ["p1","p2"]){
    const pend=pendingAtk[attackerKey];
    if(!pend||pend.done||t<pend.resolveTime)continue;
    pend.done=true;
    const defenderKey=attackerKey==="p1"?"p2":"p1",a=P[attackerKey],d=P[defenderKey],def=ATTACKS[pend.action];

    if((d.invulnUntil||0)>t||distance(a,d)>def.range||(pend.action==="fatality"&&(d.health??100)>20)){a.action="idle";a.combo=0;changed=true;continue}

    const targetAction=d.action||"idle",targetDef=ATTACKS[targetAction];
    let hit=true,chip=false,clash=false,dmg=def.damage;

    if(targetAction==="block"){
      hit=def.beats.includes("block");
      if(!hit){chip=true;dmg=Math.max(1,Math.round(def.damage*0.12))}
    }else if(targetDef){
      const attackerWins=def.beats.includes(targetAction),defenderWins=targetDef.beats.includes(pend.action);
      if(attackerWins&&!defenderWins)hit=true;
      else if(defenderWins&&!attackerWins)hit=false;
      else{clash=true;hit=false}
    }

    if(clash){
      a.health=Math.max(0,(a.health??100)-Math.round(def.damage*0.35));
      d.health=Math.max(0,(d.health??100)-Math.round((targetDef?targetDef.damage:def.damage)*0.35));
      a.action="idle";d.action="idle";a.combo=0;d.combo=0;
      const push=(a.x<=d.x)?1:-1;a.x=clampX((a.x??0)-push*40);d.x=clampX((d.x??0)+push*40);
      pendingAtk[attackerKey]=null;pendingAtk[defenderKey]=null;
      localFx="CLASH!";localFxUntil=t+500;shake=10;changed=true;
    }else if(hit){
      d.health=Math.max(0,(d.health??100)-dmg);
      const chained=(d.hitstunUntil||0)>t;
      a.combo=chained?(a.combo||0)+1:1;d.combo=0;
      d.momentum=Math.max(0,Math.min(100,(d.momentum||0)+(chip?6:15)));
      a.momentum=(pend.action==="overdrive"||pend.action==="fatality")?0:Math.max(0,Math.min(100,(a.momentum||0)+def.gain));
      d.hitstunUntil=t+(chip?180:Math.min(420,def.recovery+100));
      const kb=chip?14:Math.min(70,18+dmg*1.3),dir=(a.x<=d.x)?1:-1;
      d.x=clampX((d.x??0)+dir*kb);
      a.action="idle";if(!chip)d.action="idle";
      pendingAtk[defenderKey]=null;
      localFx=pend.action==="fatality"?"☠ FATALITY ☠":chip?"BLOCKED":(a.combo>=2?a.combo+" HIT COMBO":pend.action.toUpperCase()+" HIT");
      localFxUntil=t+550;shake=pend.action==="fatality"?26:(chip?4:14);
      changed=true;
    }else{
      a.action="idle";a.combo=0;changed=true;
    }
  }

  if(changed){
    const updates={
      "p1.health":P.p1.health,"p2.health":P.p2.health,
      "p1.momentum":P.p1.momentum,"p2.momentum":P.p2.momentum,
      "p1.action":P.p1.action,"p2.action":P.p2.action,
      "p1.x":P.p1.x,"p2.x":P.p2.x,
      "p1.hitstunUntil":P.p1.hitstunUntil||0,"p2.hitstunUntil":P.p2.hitstunUntil||0,
      "p1.combo":P.p1.combo||0,"p2.combo":P.p2.combo||0
    };
    if(P.p1.health<=0||P.p2.health<=0)updates.winner=(P.p1.health<=0&&P.p2.health<=0)?"draw":(P.p1.health<=0?2:1);
    await updateDoc(doc(db,"rooms",roomCode),updates);
  }
}

/* ---------------- rendering: animated procedural fighters ---------------- */
let flashUntil={p1:0,p2:0},prevStun={p1:0,p2:0};

function gameLoop(){drawGame();requestAnimationFrame(gameLoop)}

function drawGame(){
  const w=canvas.clientWidth,h=canvas.clientHeight;
  ctx.clearRect(0,0,w,h);
  if(!roomData)return;
  let sx=0,sy=0;
  if(shake>0){sx=(Math.random()-.5)*shake;sy=(Math.random()-.5)*shake;shake*=0.85;if(shake<0.5)shake=0}
  ctx.save();ctx.translate(sx,sy);
  const ground=h-64,scaleX=w/ARENA_W;

  // arena floor
  const floorGrad=ctx.createLinearGradient(0,ground,0,h);
  floorGrad.addColorStop(0,"#232f4a");floorGrad.addColorStop(1,"#0a0f1c");
  ctx.fillStyle=floorGrad;ctx.fillRect(0,ground,w,h-ground);
  ctx.fillStyle="rgba(120,150,220,.35)";ctx.fillRect(0,ground,w,3);
  for(let i=0;i<14;i++){ctx.fillStyle="rgba(255,255,255,.03)";ctx.fillRect((i*97+((now()/40)%97))-40,ground+10,2,h-ground);}

  const t=now();
  const p1=roomData.p1||{},p2=roomData.p2||{};
  const face1=(p2.x??0)>=(p1.x??0)?1:-1, face2=-face1;

  for(const stunKey of ["p1","p2"]){
    const stun=(roomData[stunKey]||{}).hitstunUntil||0;
    if(stun>prevStun[stunKey])flashUntil[stunKey]=t+120;
    prevStun[stunKey]=stun;
  }

  drawFighter(p1,"p1","#3b82f6","#93c5fd",ground,scaleX,face1,t);
  drawFighter(p2,"p2","#ef4444","#fca5a5",ground,scaleX,face2,t);
  ctx.restore();

  if(localFxUntil>t){
    ctx.save();ctx.font="900 26px Orbitron, sans-serif";ctx.textAlign="center";
    ctx.fillStyle="#fff";ctx.shadowColor="rgba(0,0,0,.8)";ctx.shadowBlur=10;
    ctx.fillText(localFx,w/2,74);ctx.restore();
  }
}

function drawFighter(f,key,color,glow,ground,scaleX,face,t){
  if(!f)return;
  const screenX=(f.x??0)*scaleX+ (FIGHTER_W*scaleX)/2;
  const base=ground+(f.y??0);
  const action=f.action||"idle",at=f.actionAt||0,def=ATTACKS[action];
  const inHitstun=(f.hitstunUntil||0)>t, flashing=(flashUntil[key]||0)>t;
  const airborne=(f.y??0)<-5;

  // ground shadow
  ctx.save();
  ctx.globalAlpha=Math.max(.15,.4+(f.y||0)/140);
  ctx.fillStyle="#000";ctx.beginPath();ctx.ellipse(screenX,ground+4,26+(f.y||0)/6,7,0,0,Math.PI*2);ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(screenX,base);
  ctx.scale(face,1);

  // hit-reaction lean
  let lean=0;
  if(inHitstun)lean=-0.18;
  if(action==="dash"){ // motion ghosts
    for(let i=1;i<=3;i++){ctx.save();ctx.globalAlpha=.12*i;ctx.translate(-i*10,0);drawBody(color,0,false,0);ctx.restore()}
  }

  // idle breathing / walk bob
  const bob=Math.sin(t/420)*2;
  const crouch=action==="block"?6:0;

  let armAngle=-0.35; // resting
  if(def){
    const dt=t-at,windP=dt/def.windup;
    if(dt<def.windup){armAngle=-0.35-Math.min(1,windP)*0.9} // wind back
    else{
      const activeP=Math.min(1,(dt-def.windup)/140);
      armAngle=-0.35-0.9+activeP*2.3; // swing through
      if(dt-def.windup>140){const relaxP=Math.min(1,(dt-def.windup-140)/180);armAngle=(-0.35-0.9+2.3)-relaxP*1.6}
    }
  }
  if(action==="grab"&&def){armAngle=Math.min(armAngle,0.6)}

  drawBody(color,bob+crouch,action==="block",armAngle,action,inHitstun,lean,airborne,t);

  if((f.momentum??0)>=100){
    ctx.save();ctx.globalAlpha=.55+Math.sin(t/120)*.25;
    ctx.strokeStyle="#facc15";ctx.lineWidth=3;ctx.shadowColor="#facc15";ctx.shadowBlur=18;
    ctx.beginPath();ctx.arc(0,-78,40+Math.sin(t/160)*3,0,Math.PI*2);ctx.stroke();ctx.restore();
  }
  if(flashing){ctx.save();ctx.globalCompositeOperation="lighter";ctx.fillStyle="rgba(255,255,255,.55)";ctx.beginPath();ctx.ellipse(0,-70,34,60,0,0,Math.PI*2);ctx.fill();ctx.restore()}

  ctx.restore();
}

function drawBody(color,bobY,blocking,armAngle,action,inHitstun,lean,airborne,t){
  ctx.save();ctx.translate(0,bobY);ctx.rotate(lean);

  // back leg / front leg with subtle stride
  const stride=airborne?18:Math.sin((t||0)/230)*6;
  ctx.fillStyle="#151b2c";
  ctx.beginPath();ctx.roundRect(-16-stride*0.2,-52,13,52,4);ctx.fill();
  ctx.beginPath();ctx.roundRect(4+stride*0.2,-52,13,52,4);ctx.fill();

  // torso
  const torsoH=blocking?58:66,torsoY=-52-torsoH;
  const grad=ctx.createLinearGradient(-24,torsoY,24,0);
  grad.addColorStop(0,color);grad.addColorStop(1,"#0c1220");
  ctx.fillStyle=grad;
  ctx.beginPath();ctx.roundRect(-24,torsoY,48,torsoH,10);ctx.fill();
  ctx.strokeStyle="rgba(255,255,255,.15)";ctx.lineWidth=2;ctx.stroke();

  // chest core light
  ctx.fillStyle=inHitstun?"#fff":color;ctx.globalAlpha=.9;
  ctx.beginPath();ctx.arc(0,torsoY+torsoH*0.4,5,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;

  // back arm (static, behind torso)
  ctx.save();ctx.translate(-16,torsoY+14);ctx.rotate(-armAngle*0.4+0.3);
  ctx.fillStyle="#1c2338";ctx.beginPath();ctx.roundRect(-6,0,12,34,5);ctx.fill();ctx.restore();

  // head
  ctx.beginPath();ctx.arc(2,torsoY-14,15,0,Math.PI*2);
  const hg=ctx.createRadialGradient(-4,torsoY-20,2,2,torsoY-14,16);
  hg.addColorStop(0,"#e7ecff");hg.addColorStop(1,"#8b93b0");
  ctx.fillStyle=hg;ctx.fill();
  ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(-8,torsoY-19,20,6,3);ctx.fill(); // visor

  // front arm (the acting limb) pivoted at shoulder
  ctx.save();ctx.translate(18,torsoY+12);ctx.rotate(armAngle);
  ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(-6,0,13,36,5);ctx.fill();
  if(action==="light"||action==="heavy"||action==="overdrive"||action==="fatality"){
    ctx.fillStyle=action==="heavy"?"#fecaca":action==="fatality"?"#ef4444":action==="overdrive"?"#fde047":"#bfdbfe";
    ctx.beginPath();ctx.roundRect(-4,32,9,action==="heavy"?26:20,4);ctx.fill();
  }
  ctx.restore();

  if(action==="grab"){
    ctx.strokeStyle="#ddd6fe";ctx.lineWidth=6;ctx.beginPath();ctx.arc(38,torsoY+18,26,-1,1);ctx.stroke();
  }
  if(blocking){
    ctx.save();ctx.strokeStyle="rgba(226,232,240,.85)";ctx.lineWidth=6;ctx.shadowColor="#93c5fd";ctx.shadowBlur=10;
    ctx.beginPath();ctx.arc(20,torsoY+22,30,-1.3,1.3);ctx.stroke();ctx.restore();
  }
  if(action==="overdrive"){ctx.strokeStyle="#fde047";ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,torsoY+20,52,0,Math.PI*2);ctx.stroke()}
  if(action==="fatality"){ctx.strokeStyle="#ef4444";ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,torsoY+20,58,0,Math.PI*2);ctx.stroke()}

  ctx.restore();
}

function showMessage(text){const m=document.getElementById("message");m.textContent=text;m.classList.remove("hit");void m.offsetWidth;m.classList.add("hit");setTimeout(()=>{if(m.textContent===text)m.textContent=""},650)}
function finishGame(winner){if(gameOver)return;gameOver=true;showMessage(winner==="draw"?"DRAW!":(winner===1?roomData.players[0]:roomData.players[1])+" WINS!");setTimeout(()=>showMessage("☠ FATALITY ☠"),850);setTimeout(restartRound,3000)}
async function restartRound(){if(myPlayer!==1)return;pendingAtk={p1:null,p2:null};await updateDoc(doc(db,"rooms",roomCode),{"p1":baseP(90),"p2":baseP(ARENA_W-90-FIGHTER_W),timer:75,winner:null,status:"ready"});gameOver=false}
