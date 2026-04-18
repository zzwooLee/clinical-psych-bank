/* common.js */
let allQuestions = [];
let currentIndex = 0;
let currentUser = { email: '', status: 'free' }; // 실제 구현 시 API를 통해 가져옴

// 1. 문제 데이터 로드 (기존 questions.gs 대체)
async function loadQuestions(filters = {}) {
  const questionArea = document.getElementById('question-area');
  questionArea.innerHTML = '<div class="loading">문제를 불러오는 중...</div>';

  try {
    // Vercel 배포 시 생성할 API 엔드포인트로 요청
    const response = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: document.getElementById('sel-grade')?.value,
        category: document.getElementById('sel-category')?.value,
        userStatus: currentUser.status
      })
    });
    
    allQuestions = await response.json();
    currentIndex = 0;
    renderQuestion();
  } catch (error) {
    questionArea.innerHTML = '<div class="error">데이터 로드에 실패했습니다.</div>';
    console.error("Error:", error);
  }
}

// 2. 문제 렌더링 (기존 premium.html/free.html 로직 통합)
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

// 3. 정답 확인 로직
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