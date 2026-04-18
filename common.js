/* common.js */
let allQuestions = [];
let currentIndex = 0;
// 현재 접속 유저 정보 저장 (초기값)
let currentUser = { email: '', status: 'free' }; 

/**
 * 1. 회원가입 처리 (Vercel API 이용)
 */
async function handleSignUp() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  if (!email || !password) return alert("이메일과 비밀번호를 입력해주세요.");

  try {
    const response = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const result = await response.json();
    if (response.ok) {
      alert("가입 확인 이메일을 보냈습니다! 메일함을 확인해주세요.");
    } else {
      alert("가입 실패: " + result.message);
    }
  } catch (error) {
    console.error("Signup error:", error);
    alert("서버 통신 중 오류가 발생했습니다.");
  }
}

/**
 * 2. 로그인 처리 및 등급별 페이지 이동
 */
async function handleLogin() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  if (!email || !password) return alert("이메일과 비밀번호를 입력해주세요.");

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const result = await response.json();
    if (response.ok) {
      // 1. 유저 정보 저장
      currentUser.email = result.user.email;
      currentUser.status = result.status;
      
      // 2. 등급에 따른 페이지 이동 로직
      if (currentUser.status === 'premium' || currentUser.status === 'admin') {
        alert(`${currentUser.email}님(PREMIUM), 전용 학습 페이지로 이동합니다.`);
        location.href = 'premium.html'; // 프리미엄 페이지로 이동
      } else {
        alert("로그인 성공! 무료 등급 문제를 이용하실 수 있습니다.");
        // index.html 내의 유저 뷰 업데이트
        updateUserUI();
      }
    } else {
      alert("로그인 실패: " + result.message);
    }
  } catch (error) {
    console.error("Login error:", error);
    alert("로그인 중 서버 오류가 발생했습니다.");
  }
}

/**
 * 3. 로그인 상태에 따른 UI 업데이트 (index.html용)
 */
function updateUserUI() {
  const guestView = document.getElementById('guest-view');
  const userView = document.getElementById('user-view');
  const info = document.getElementById('user-display-info');

  if (guestView && userView) {
    guestView.style.display = 'none';
    userView.style.display = 'block';
    info.innerText = `${currentUser.email}님 환영합니다! (등급: ${currentUser.status.toUpperCase()})`;
  }
}

/**
 * 4. 로그아웃 처리
 */
function handleLogout() {
  currentUser = { email: '', status: 'free' };
  alert("로그아웃 되었습니다.");
  location.href = 'index.html'; // 메인으로 복귀
}

/**
 * 5. 문제 데이터 로드 (필터링 반영)
 */
async function loadQuestions() {
  const area = document.getElementById('question-area');
  area.innerHTML = '<div class="loading">문제를 구성하는 중...</div>';

  const payload = {
    grade: document.getElementById('sel-grade')?.value,
    category: document.getElementById('sel-category')?.value,
    year: document.getElementById('sel-year')?.value,
    userStatus: currentUser.status
  };

  try {
    const response = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) throw new Error("로드 실패");

    allQuestions = await response.json();
    currentIndex = 0;
    renderQuestion();
  } catch (error) {
    area.innerHTML = '<div class="error">데이터 로드 실패</div>';
  }
}

/**
 * 6. 프리미엄 카드 UI 렌더링 (이미지 디자인 적용)
 */
function renderQuestion() {
  const area = document.getElementById('question-area');
  if (allQuestions.length === 0) {
    area.innerHTML = '<div class="card">해당 조건의 문제가 없습니다. 필터를 확인해주세요.</div>';
    return;
  }

  const q = allQuestions[currentIndex];
  area.innerHTML = `
    <div class="card">
      <div class="card-header-info">
        <span>문제 ${currentIndex + 1}</span>
        <span>${q.category || '과목 미지정'}</span>
      </div>
      <div class="card-question">
        ${q.question}
      </div>
      <div class="choices">
        ${[1, 2, 3, 4].map(num => `
          <button class="choice-btn" id="choice-${num}" onclick="checkAnswer(${num})">
            <span class="choice-num">${num}</span>
            <span class="choice-text">${q['choice' + num]}</span>
          </button>
        `).join('')}
      </div>
      <div id="result-box" class="result-box" style="display:none; margin-top:15px; padding:15px; border-radius:8px;"></div>
      
      <div class="card-footer">
        <button class="btn-nav" onclick="changeQuestion(-1)" ${currentIndex === 0 ? 'disabled' : ''}>이전</button>
        <span class="page-indicator">${currentIndex + 1} / ${allQuestions.length}</span>
        <button class="btn-nav active" onclick="changeQuestion(1)" ${currentIndex === allQuestions.length - 1 ? 'disabled' : ''}>다음</button>
      </div>
    </div>
  `;
}

/**
 * 7. 정답 확인 및 문제 이동
 */
function checkAnswer(selected) {
  const correct = allQuestions[currentIndex].answer;
  const resultBox = document.getElementById('result-box');
  
  // 정답/오답 스타일 적용
  const btns = document.querySelectorAll('.choice-btn');
  btns.forEach(btn => btn.style.pointerEvents = 'none'); // 중복 클릭 방지

  if (selected == correct) {
    document.getElementById(`choice-${selected}`).style.borderColor = "#2ecc71";
    document.getElementById(`choice-${selected}`).style.background = "#eafaf2";
    resultBox.innerHTML = "✅ 정답입니다!";
  } else {
    document.getElementById(`choice-${selected}`).style.borderColor = "#e74c3c";
    document.getElementById(`choice-${selected}`).style.background = "#fdf0ee";
    document.getElementById(`choice-${correct}`).style.borderColor = "#2ecc71";
    resultBox.innerHTML = `❌ 오답입니다. 정답은 ${correct}번입니다.`;
  }
  resultBox.style.display = 'block';
}

function changeQuestion(step) {
  currentIndex += step;
  renderQuestion();
}

// 랜덤 출제 전용 함수 (필터 없이 섞기)
function loadRandomQuestions() {
    loadQuestions(); // 현재는 동일하게 작동하되 필요시 정렬 로직 추가 가능
}
