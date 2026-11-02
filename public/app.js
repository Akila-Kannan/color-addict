(() => {
  const $=id=>document.getElementById(id), colors=[['RED','#fa5266'],['BLUE','#5b7cfa'],['GREEN','#46c98b'],['YELLOW','#f4bf4f'],['PURPLE','#b781f5'],['ORANGE','#ff9257']];
  let ws, myId='', room='', state=null, rounds=10, toastTimer;
  const send=o=>{if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(o));};
  const show=(id)=>{['landing','roomView','gameView','finishedView'].forEach(x=>$(x).classList.toggle('hidden',x!==id));};
  function toast(text){const t=$('toast');t.textContent=text;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2600);}
  function connect(payload){
    $('landingError').textContent='';
    const proto=location.protocol==='https:'?'wss:':'ws:'; ws=new WebSocket(`${proto}//${location.host}`);
    ws.onopen=()=>send(payload);
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='error'){if(!room)$('landingError').textContent=m.message;else toast(m.message);return;}if(m.type==='joined'){room=m.room;myId=m.id;$('roomCodeDisplay').textContent=room;$('gameRoomCode').textContent=room;show('roomView');}if(m.type==='feedback'){const f=$('feedbackLine');f.textContent=m.text;f.style.color=m.ok?'#46b77e':'#e46464';}if(m.type==='state'){state=m;render();}};
    ws.onclose=()=>{if(room)toast('Connection lost. Refresh to rejoin the room.');$('connectionLabel').textContent='DISCONNECTED';};
    ws.onerror=()=>{if(!room)$('landingError').textContent='Could not connect. Start the game server and try again.';};
  }
  function getName(){return $('playerName').value.trim()||'Player';}
  $('createRoom').onclick=()=>connect({type:'join',create:true,name:getName()});
  $('joinRoom').onclick=()=>{const code=$('roomCode').value.trim().toUpperCase();if(code.length<4){$('landingError').textContent='Enter the 5-letter room code.';return;}connect({type:'join',code,name:getName()});};
  $('roomCode').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5));
  $('roomCode').addEventListener('keydown',e=>{if(e.key==='Enter')$('joinRoom').click();}); $('playerName').addEventListener('keydown',e=>{if(e.key==='Enter')$('createRoom').click();});
  $('copyCode').onclick=async()=>{try{await navigator.clipboard.writeText(room);toast('Room code copied!');}catch{toast(`Room code: ${room}`);}};
  $('minusRounds').onclick=()=>{rounds=Math.max(5,rounds-1);$('roundCount').textContent=rounds;}; $('plusRounds').onclick=()=>{rounds=Math.min(20,rounds+1);$('roundCount').textContent=rounds;};
  $('startGame').onclick=()=>send({type:'start',total:rounds}); $('playAgain').onclick=()=>{if(state?.players.find(p=>p.id===myId)?.host)show('roomView');else toast('Waiting for the host to start again.');};
  $('rulesTrigger').onclick=()=>$('rulesModal').classList.remove('hidden'); $('closeRules').onclick=()=>$('rulesModal').classList.add('hidden'); $('rulesModal').addEventListener('click',e=>{if(e.target===$('rulesModal'))$('rulesModal').classList.add('hidden');});
  function render(){if(!state)return;$('playerCount').textContent=`${state.players.length} / 8`;$('waitingNote').classList.toggle('hidden',state.players.length>=8);
    $('playerList').innerHTML=state.players.map((p,i)=>`<div class="player-card"><span class="avatar" style="background:${colors[i%colors.length][1]}">${esc(p.name.slice(0,1).toUpperCase())}</span><b>${esc(p.name)}</b>${p.host?'<span class="host-tag">HOST</span>':''}</div>`).join('');
    const me=state.players.find(p=>p.id===myId);$('startGame').disabled=!me?.host;$('startGame').style.opacity=me?.host?'1':'.45';if(me&&!me.host)$('startGame').querySelector('span').textContent='WAITING FOR HOST';else $('startGame').querySelector('span').textContent='START GAME';
    if(state.phase==='lobby'){show('roomView');return;} if(state.phase==='finished'){show('finishedView');renderFinish();return;}show('gameView');
    $('roundText').innerHTML=state.suddenDeath?`SUDDEN DEATH <b>· TIED PLAYERS ONLY</b>`:`CARD ${String(state.round).padStart(2,'0')} <b>/ ${state.total}</b>`;$('progressBar').style.width=state.suddenDeath?'100%':`${(state.round/state.total)*100}%`;
    if(state.phase==='ready'){$('readyOverlay').classList.remove('hidden');$('answerGrid').style.pointerEvents='none';setTimeout(()=>$('readyOverlay').classList.add('hidden'),1800);return;}
    $('readyOverlay').classList.add('hidden');$('answerGrid').style.pointerEvents='auto';$('promptWord').textContent=state.prompt;$('lookAtLabel').textContent=state.prompt==='WORD'?'READ THE WORD':'LOOK AT THE INK';$('challengeWord').textContent=state.card?.word||'—';$('challengeWord').style.color=state.card?.inkHex||'#333';$('challengeWord').classList.remove('pop');void $('challengeWord').offsetWidth;$('challengeWord').classList.add('pop');
    const shouldLock=me?.locked;$('answerGrid').innerHTML=colors.map(([name,hex])=>`<button class="answer-button" data-color="${name}" ${shouldLock?'disabled':''}><i class="answer-swatch" style="--swatch:${hex}"></i><span>${name}</span></button>`).join('');$('answerGrid').querySelectorAll('button').forEach(b=>b.onclick=()=>send({type:'answer',color:b.dataset.color}));
    const result=state.lastResult;
    $('feedbackLine').textContent=result?`${result.id===myId?'YOU':result.name} +${result.points} · TOTAL ${result.total}${result.bonus?' · SPEED BONUS':''}`:'First correct answer gets a +1 speed bonus';$('feedbackLine').style.color=result?.id===myId?'#46b77e':'#aaa69d';
    $('scoreList').innerHTML=[...state.players].sort((a,b)=>b.score-a.score).map((p,i)=>`<div class="score-row ${p.id===myId?'me':''}"><span class="avatar" style="background:${colors[state.players.indexOf(p)%colors.length][1]}">${esc(p.name.slice(0,1).toUpperCase())}</span><b>${esc(p.name)}</b><strong>${p.score}</strong></div>`).join('');
    $('lastScorer').textContent=result?`✦ ${result.id===myId?'Your score':`${result.name}’s score`} is now ${result.total}`:'Be quick. Be correct.';
  }
  function renderFinish(){const sorted=[...state.players].sort((a,b)=>b.score-a.score);const high=sorted[0]?.score||0;const names=sorted.filter(p=>p.score===high).map(p=>p.name);$('finishTitle').innerHTML=names.length>1?'It’s a<br><span>color tie!</span>':`${esc(names[0]||'Well played')}<br><span>you legend.</span>`;$('finishSubtitle').textContent=`${high} points · ${state.total} cards · an excellent brain workout`;$('finalScores').innerHTML=sorted.map((p,i)=>`<div class="final-row ${i===0?'first':''}"><span class="final-rank">${String(i+1).padStart(2,'0')}</span><b>${esc(p.name)}</b><strong>${p.score}</strong></div>`).join('');$('playAgain').classList.toggle('hidden',!state.players.find(p=>p.id===myId)?.host);}
  function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
})();
