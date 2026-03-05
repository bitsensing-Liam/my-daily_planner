import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { 
  CheckCircle2, Clock, MessageSquare, Plus, Trash2, Calendar, 
  Target, Save, Loader2, Database, Download, Upload 
} from 'lucide-react';

// --- Firebase 설정 (Vercel 환경 변수 또는 시스템 제공값 사용) ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

const App = () => {
  const [user, setUser] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const fileInputRef = useRef(null);

  // 플래너 핵심 데이터 상태
  const [tasks, setTasks] = useState([]);
  const [schedule, setSchedule] = useState({});
  const [feedback, setFeedback] = useState({ 
    identity: '', 
    reflection: '', 
    improvement: '' 
  });

  // 오늘 날짜 문자열 생성 (YYYY-MM-DD)
  const getLocalTodayString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // 1. 사용자 인증 로직 (익명 로그인 포함)
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("인증 오류:", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. 클라우드 데이터 실시간 동기화 (오늘 날짜 기준)
  useEffect(() => {
    if (!user) return;
    const todayStr = getLocalTodayString();
    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'dailyPlans', todayStr);

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setTasks(data.tasks ? JSON.parse(data.tasks) : []);
        setSchedule(data.schedule ? JSON.parse(data.schedule) : {});
        setFeedback(data.feedback ? JSON.parse(data.feedback) : { identity: '', reflection: '', improvement: '' });
      }
      setIsLoaded(true);
    }, (err) => {
      console.error("데이터 로딩 오류:", err);
      setIsLoaded(true);
    });

    return () => unsubscribe();
  }, [user]);

  // 3. JSON 내보내기 (구글 드라이브 백업용)
  const exportToJson = () => {
    const dataStr = JSON.stringify({
      date: getLocalTodayString(),
      tasks,
      schedule,
      feedback
    }, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `planner_${getLocalTodayString()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setSaveMsg('JSON 파일로 저장되었습니다! 📂');
    setTimeout(() => setSaveMsg(''), 3000);
  };

  // 4. JSON 불러오기
  const importFromJson = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        if (json.tasks) setTasks(json.tasks);
        if (json.schedule) setSchedule(json.schedule);
        if (json.feedback) setFeedback(json.feedback);
        setSaveMsg('파일 데이터를 불러왔습니다! ✅');
        setTimeout(() => setSaveMsg(''), 3000);
      } catch (err) {
        alert('올바른 형식의 JSON 파일이 아닙니다.');
      }
    };
    reader.readAsText(file);
  };

  // 5. 클라우드 수동 저장
  const saveToCloud = async () => {
    if (!user) return;
    setSaveMsg('저장 중...');
    const todayStr = getLocalTodayString();
    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'dailyPlans', todayStr);
    
    try {
      await setDoc(docRef, {
        tasks: JSON.stringify(tasks),
        schedule: JSON.stringify(schedule),
        feedback: JSON.stringify(feedback),
        updatedAt: new Date().toISOString()
      }, { merge: true });
      setSaveMsg('클라우드 저장 완료! ☁️');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (e) {
      setSaveMsg('저장 실패!');
    }
  };

  if (!isLoaded) return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF9F6]">
      <Loader2 className="animate-spin text-[#E27D60]" size={32} />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#17535B] font-sans p-4 md:p-8">
      {/* 상단 헤더 및 도구 모음 */}
      <header className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row justify-between items-end border-b-2 border-[#E27D60] pb-4 gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">DAILY PLANNER</h1>
          <p className="text-xs font-mono opacity-50 mt-1 flex items-center gap-1">
            <Database size={12} /> Local & Cloud Sync Active
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          {saveMsg && <span className="text-xs font-bold text-[#E27D60] mr-2">{saveMsg}</span>}
          
          <input type="file" ref={fileInputRef} onChange={importFromJson} className="hidden" accept=".json" />
          <button 
            onClick={() => fileInputRef.current.click()}
            className="flex items-center gap-2 bg-white border border-[#17535B]/20 px-3 py-2 rounded-lg text-xs font-bold hover:bg-gray-50 transition-all"
          >
            <Upload size={14} /> 불러오기
          </button>
          <button 
            onClick={exportToJson}
            className="flex items-center gap-2 bg-white border border-[#17535B]/20 px-3 py-2 rounded-lg text-xs font-bold hover:bg-gray-50 transition-all"
          >
            <Download size={14} /> 내보내기
          </button>
          <button 
            onClick={saveToCloud}
            className="flex items-center gap-2 bg-[#17535B] text-white px-4 py-2 rounded-lg text-xs font-bold shadow-md hover:bg-opacity-90 transition-all ml-2"
          >
            <Save size={14} /> 클라우드 저장
          </button>
        </div>
      </header>

      {/* 메인 콘텐츠 레이아웃 */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* 왼쪽: 정체성 및 피드백 (확장형) */}
        <div className="lg:col-span-3 space-y-6">
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-[#17535B]/10">
            <h3 className="flex items-center gap-2 font-bold mb-4 text-[#E27D60]"><Target size={18} /> 정체성 확립</h3>
            <textarea 
              className="w-full h-32 p-3 text-sm bg-[#FAF9F6] rounded-xl border-none focus:ring-1 focus:ring-[#17535B] outline-none resize-none"
              placeholder="나는 오늘 어떤 모습으로 살 것인가?"
              value={feedback.identity}
              onChange={(e) => setFeedback({...feedback, identity: e.target.value})}
            />
          </section>
          
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-[#17535B]/10">
            <h3 className="flex items-center gap-2 font-bold mb-4 text-[#E27D60]"><MessageSquare size={18} /> 데일리 피드백</h3>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold opacity-40 uppercase block mb-1">잘한 점 / 성취</label>
                <textarea 
                  className="w-full h-52 p-3 text-sm bg-[#FAF9F6] rounded-xl border-none focus:ring-1 focus:ring-[#17535B] outline-none resize-none leading-relaxed"
                  placeholder="오늘의 작은 성공들을 기록하세요."
                  value={feedback.reflection}
                  onChange={(e) => setFeedback({...feedback, reflection: e.target.value})}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold opacity-40 uppercase block mb-1">개선할 점 / 다짐</label>
                <textarea 
                  className="w-full h-52 p-3 text-sm bg-[#FAF9F6] rounded-xl border-none focus:ring-1 focus:ring-[#17535B] outline-none resize-none leading-relaxed"
                  placeholder="무엇을 더 잘할 수 있었을까요?"
                  value={feedback.improvement}
                  onChange={(e) => setFeedback({...feedback, improvement: e.target.value})}
                />
              </div>
            </div>
          </section>
        </div>

        {/* 중앙: 할 일 관리 (상태 및 미루기 일정) */}
        <div className="lg:col-span-6">
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-[#17535B]/10 h-full min-h-[600px]">
            <div className="flex justify-between items-center mb-6">
              <h3 className="flex items-center gap-2 font-bold text-xl"><CheckCircle2 size={22} className="text-[#E27D60]" /> 할 일 관리</h3>
              <button 
                onClick={() => setTasks([...tasks, { id: Date.now(), text: '', status: '대기', reschedule: '' }])}
                className="p-2 bg-[#17535B] text-white rounded-full hover:shadow-lg transition-all"
              >
                <Plus size={18} />
              </button>
            </div>
            
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left opacity-40 text-[10px] uppercase tracking-widest border-b border-[#17535B]/10">
                  <th className="pb-2">업무 내용</th>
                  <th className="pb-2 w-24">상태</th>
                  <th className="pb-2 w-32">미룰 시 일정</th>
                  <th className="pb-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#17535B]/5">
                {tasks.map((task) => (
                  <tr key={task.id} className="group hover:bg-[#FAF9F6]/50">
                    <td className="py-3 pr-4">
                      <input 
                        type="text" className="w-full bg-transparent border-none p-0 focus:ring-0 text-[#17535B] placeholder:opacity-20" 
                        value={task.text} placeholder="할 일을 입력하세요..."
                        onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? {...t, text: e.target.value} : t))}
                      />
                    </td>
                    <td className="py-2">
                      <select 
                        className="bg-[#FAF9F6] text-[10px] font-bold p-1 rounded border-none w-full cursor-pointer" 
                        value={task.status} 
                        onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? {...t, status: e.target.value} : t))}
                      >
                        <option>대기</option><option>진행중</option><option>완료</option><option>미루기</option>
                      </select>
                    </td>
                    <td className="py-2">
                      <input 
                        type="text" 
                        disabled={task.status !== '미루기'}
                        className={`w-full bg-[#FAF9F6] border-none text-[10px] rounded p-1 ${task.status !== '미루기' ? 'opacity-10' : 'opacity-100 text-[#E27D60] font-bold'}`}
                        placeholder="대체 날짜"
                        value={task.reschedule}
                        onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? {...t, reschedule: e.target.value} : t))}
                      />
                    </td>
                    <td className="py-2 text-right">
                      <button onClick={() => setTasks(tasks.filter(t => t.id !== task.id))} className="text-red-300 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        {/* 오른쪽: 타임박스 (30분 단위 시간표) */}
        <div className="lg:col-span-3">
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-[#17535B]/10 max-h-[85vh] overflow-y-auto custom-scrollbar">
            <h3 className="flex items-center gap-2 font-bold mb-4 border-b pb-2"><Clock size={18} className="text-[#E27D60]" /> Time Box</h3>
            <div className="space-y-1">
              {Array.from({ length: 37 }, (_, i) => {
                const h = Math.floor(i / 2) + 5;
                const m = i % 2 === 0 ? '00' : '30';
                const time = `${h.toString().padStart(2, '0')}:${m}`;
                return (
                  <div key={time} className="flex gap-2 py-1 items-center border-l-2 border-transparent hover:border-[#E27D60] pl-2 transition-all">
                    <span className="text-[10px] font-mono opacity-40 w-8">{time}</span>
                    <input 
                      type="text" className="flex-1 text-xs bg-transparent border-none p-0 focus:ring-0" 
                      placeholder="ㅡ"
                      value={schedule[time] || ''} onChange={(e) => setSchedule({...schedule, [time]: e.target.value})}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #17535B20; border-radius: 10px; }
        input:focus { outline: none; }
      `}} />
    </div>
  );
};

export default App;