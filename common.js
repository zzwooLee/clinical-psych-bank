/* common.js */
let allQuestions = [];
let currentIndex = 0;
// 초기 사용자 상태 설정 (로그인 전 기본값)
/* common.js */
let currentUser = { email: '', status: 'free', token: null };

// 회원가입 호출
async function handleSignUp() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  const response = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const result = await response.json();
  if (response.ok) alert("가입 확인 이메일을 확인해주세요!");
  else alert("에러: " + result.message);
}

// 로그인 호출
async function handleLogin() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const result = await response.json();
  if (response.ok) {
    currentUser.email = result.user.email;
    currentUser.status = result.status;
    currentUser.token = result.session.access_token; // 보안을 위해 세션 토큰 보관
    
    document.getElementById('guest-view').style.display = 'none';
    document.getElementById('user-view').style.display = 'block';
    document.getElementById('user-display-info').innerText = 
      `${currentUser.email}님 (등급: ${currentUser.status.toUpperCase()})`;
  } else {
    alert("로그인 실패: " + result.message);
  }
}

/**
 * 1. 로그인 상태 실시간 감지 및 UI 업데이트
 * 페이지 로드 시 및 로그인/로그아웃 시 자동으로 실행됩니다.
 */
supabase.auth.onAuthStateChange(async (event, session) => {
  const guestView = document.getElementById('guest-view');
  const userView = document.getElementById('user-view');
  const userDisplayInfo = document.getElementById('user-display-info');

  if (session) {
    // A. 로그인된 상태
    if (guestView) guestView.style.display = 'none';
    if (userView) userView.style.display = 'block';

    // Supabase 'users' 테이블에서 해당 유저의 등급(user_status) 조회
    const { data: profile, error } = await supabase
      .from('users')
      .select('user_status')
      .eq('id', session.user.id)
      .single();

    // 등급 정보 업데이트 (데이터가 없으면 기본값 'free')
    currentUser.email = session.user.email;
    currentUser.status = (profile && profile.user_status) ? profile.user_status : 'free';
    
    if (userDisplayInfo) {
      userDisplayInfo.innerText = `${currentUser.email}님 환영합니다! (등급: ${currentUser.status.toUpperCase()})`;
    }
    
    console.log("현재 접속 유저 등급:", currentUser.status);
  } else {
    // B. 로그아웃 상태
    if (guestView) guestView.style.display = 'block';
    if (userView) userView.style.display = 'none';
    
    currentUser = { email: '', status: 'free' };
    console.log("로그아웃 상태: 기본 등급 적용");
  }
});

/**
 * 2. 회원가입/로그인/로그아웃 함수
 */
async function handleSignUp() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  if (!email || !password) return alert("이메일과 비밀번호를 입력해주세요.");

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) alert("가입 실패: " + error.message);
  else alert("가입 확인 이메일을 보냈습니다! 메일함을 확인해주세요.");
}

async function handleLogin() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  if (!email || !password) return alert("이메일과 비밀번호를 입력해주세요.");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) alert("로그인 실패: " + error.message);
  // 성공 시 onAuthStateChange에서 감지하여 UI를 변경함
}

async function handleLogout() {
  await supabase.auth.signOut();
  alert("로그아웃 되었습니다.");
  location.reload(); 
}

/**
 * 3. 문제 데이터 로드
 * 백엔드로 요청을 보낼 때 currentUser.status를 담아서 보냅니다.
 */
async function loadQuestions(filters = {}) {
  const questionArea = document.getElementById('question-area');
  questionArea.innerHTML = '<div class="loading">문제를 불러오는 중...</div>';

  try {
    const response = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: document.getElementById('sel-grade')?.value,
        category: document.getElementById('sel-category')?.value,
        userStatus: currentUser.status // 등급 정보 전달
      })
    });
    
    // 서버 에러 응답 처리
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText);
    }

    allQuestions = await response.json();
    currentIndex = 0;
    renderQuestion();
  } catch (error) {
    questionArea.innerHTML = '<div class="error">데이터 로드에 실패했습니다.</div>';
    console.error("Error:", error);
  }
}

/**
 * 4. 문제 렌더링
 */
function renderQuestion() {
  const area = document.getElementById('question-area');
  if (allQuestions.length === 0) {
    area.innerHTML = '<div class="card">해당 조건의 문제가 없습니다.</div>';
    return;
  }

  const q = allQuestions[currentIndex];
  area.innerHTML = `
    <div class="card">
      <div style="font-size:13px; color:var(--text-3); margin-bottom:10px;">
        ${q.grade}급 | ${q.category} | ${q.exam_date || '예상문제'}
      </div>
      <div style="font-size:17px; font-weight:500; margin-bottom:20px;">
        ${currentIndex + 1}. ${q.question}
      </div>
      <div class="choices">
        ${[1,2,3,4].map(num => `
          <button class="choice-btn" id="choice-${num}" onclick="checkAnswer(${num})">
            ${num}. ${q['choice' + num]}
          </button>
        `).join('')}
      </div>
      <div id="result-box" class="result-box" style="display:none; margin-top:15px; padding:15px; border-radius:8px;"></div>
      <div class="nav-buttons" style="display:flex; justify-content:space-between; margin-top:20px;">
        <button onclick="changeQuestion(-1)" ${currentIndex === 0 ? 'disabled' : ''}>이전</button>
        <span>${currentIndex + 1} / ${allQuestions.length}</span>
        <button onclick="changeQuestion(1)" ${currentIndex === allQuestions.length - 1 ? 'disabled' : ''}>다음</button>
      </div>
    </div>
  `;
}

/**
 * 5. 정답 확인 및 문제 이동
 */
function checkAnswer(selected) {
  const correct = allQuestions[currentIndex].answer;
  const resultBox = document.getElementById('result-box');
  
  if (selected == correct) {
    document.getElementById(`choice-${selected}`).classList.add('correct');
    resultBox.innerHTML = "✅ 정답입니다!";
    resultBox.style.background = "#eafaf2";
  } else {
    document.getElementById(`choice-${selected}`).classList.add('wrong');
    document.getElementById(`choice-${correct}`).classList.add('correct');
    resultBox.innerHTML = `❌ 오답입니다. 정답은 ${correct}번입니다.`;
    resultBox.style.background = "#fdf0ee";
  }
  resultBox.style.display = 'block';
}

function changeQuestion(step) {
  currentIndex += step;
  renderQuestion();
}
