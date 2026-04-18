/* common.js */
let allQuestions = [];
let currentIndex = 0;
// 현재 접속 유저 정보 저장용
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
 * 2. 로그인 처리 (Vercel API 이용)
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
      // 서버에서 돌려준 유저 정보 저장
      currentUser.email = result.user.email;
      currentUser.status = result.status;
      
      // UI 업데이트
      document.getElementById('guest-view').style.display = 'none';
      document.getElementById('user-view').style.display = 'block';
      document.getElementById('user-display-info').innerText = 
        `${currentUser.email}님 환영합니다! (등급: ${currentUser.status.toUpperCase()})`;
      
      alert("로그인 성공!");
    } else {
      alert("로그인 실패: " + result.message);
    }
  } catch (error) {
    console.error("Login error:", error);
    alert("로그인 중 서버 오류가 발생했습니다.");
  }
}

/**
 * 3. 로그아웃 처리
 */
function handleLogout() {
  currentUser = { email: '', status: 'free' };
  document.getElementById('guest-view').style.display = 'block';
  document.getElementById('user-view').style.display = 'none';
  alert("로그아웃 되었습니다.");
  location.reload(); 
}

/**
 * 4. 문제 데이터 로드
 */
async function loadQuestions() {
  const questionArea = document.getElementById('question-area');
  questionArea.innerHTML = '<div class="loading">문제를 불러오는 중...</div>';

  try {
    const response = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: document.getElementById('sel-grade')?.value,
        category: document.getElementById('sel-category')?.value,
        userStatus: currentUser.status // 로그인 시 저장된 등급 전달
      })
    });
    
    if (!response.ok) throw new Error("데이터 로드 실패");

    allQuestions = await response.json();
    currentIndex = 0;
    renderQuestion();
  } catch (error) {
    questionArea.innerHTML = '<div class="error">문제를 가져오지 못했습니다.</div>';
    console.error("Load Error:", error);
  }
}

/**
 * 5. 문제 및 정답 렌더링 (이전과 동일)
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
      <div style="font-size:13px; color:#666; margin-bottom:10px;">${q.grade}급 | ${q.category}</div>
      <div style="font-size:17px; margin-bottom:20px;">${currentIndex + 1}. ${q.question}</div>
      <div class="choices">
        ${[1,2,3,4].map(num => `
          <button class="choice-btn" id="choice-${num}" onclick="checkAnswer(${num})">${num}. ${q['choice'+num]}</button>
        `).join('')}
      </div>
      <div id="result-box" class="result-box" style="display:none; margin-top:15px; padding:15px; border-radius:8px;"></div>
      <div style="display:flex; justify-content:space-between; margin-top:20px;">
        <button onclick="changeQuestion(-1)" ${currentIndex === 0 ? 'disabled' : ''}>이전</button>
        <button onclick="changeQuestion(1)" ${currentIndex === allQuestions.length - 1 ? 'disabled' : ''}>다음</button>
      </div>
    </div>
  `;
}

function checkAnswer(selected) {
  const correct = allQuestions[currentIndex].answer;
  const resultBox = document.getElementById('result-box');
  if (selected == correct) {
    resultBox.innerHTML = "✅ 정답입니다!";
    resultBox.style.background = "#eafaf2";
  } else {
    resultBox.innerHTML = `❌ 오답입니다. 정답은 ${correct}번입니다.`;
    resultBox.style.background = "#fdf0ee";
  }
  resultBox.style.display = 'block';
}

function changeQuestion(step) {
  currentIndex += step;
  renderQuestion();
}
