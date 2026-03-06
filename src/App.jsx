import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import {
  CheckCircle2, Clock, MessageSquare, Plus, Trash2, Calendar,
  Target, Save, Loader2, Database, Download, Upload, Merge, SplitSquareHorizontal, Link, X, ChevronUp, ChevronDown, GripVertical, FileText
} from 'lucide-react';

/**
 * [Vercel 배포 시 주의사항]
 * Vercel 설정창(Environment Variables)에 다음 두 항목을 반드시 추가해야 클라우드 저장이 작동합니다.
 * 1. VITE_FIREBASE_CONFIG : 파이어베이스 설정 JSON 문자열
 * 2. VITE_APP_ID : 프로젝트를 구분할 고유 이름 (예: my-planner)
 */

// --- 환경 변수 로드 ---
const rawConfig = import.meta.env?.VITE_FIREBASE_CONFIG;
let firebaseConfig = {};
try {
  if (rawConfig) firebaseConfig = JSON.parse(rawConfig);
} catch (e) {
  console.error("Firebase Config 파싱 실패:", e);
}

const appId = import.meta.env?.VITE_APP_ID || 'default-app-id';

// Firebase 서비스 초기화 (설정값이 있을 때만)
let app, auth, db;
if (firebaseConfig && firebaseConfig.apiKey) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

const App = () => {
  const [user, setUser] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const fileInputRef = useRef(null);

  // 플래너 데이터 상태
  const [tasks, setTasks] = useState([]);
  const [schedule, setSchedule] = useState({});
  const [feedback, setFeedback] = useState({
    identity: '',
    reflection: '',
    improvement: ''
  });
  const [mergedSlots, setMergedSlots] = useState({});  // { "14:00": "16:30" } = 14:00~16:30 합쳐진 블록
  const [scheduleLinks, setScheduleLinks] = useState({});  // { "14:00": taskId } = 시간-할일 연결
  const [selectedSlots, setSelectedSlots] = useState(new Set());
  const [isMergeMode, setIsMergeMode] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [plannerDate, setPlannerDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  // 전체 타임슬롯 배열 생성
  const allTimes = Array.from({ length: 37 }, (_, i) => {
    const h = Math.floor(i / 2) + 5;
    const m = i % 2 === 0 ? '00' : '30';
    return `${h.toString().padStart(2, '0')}:${m}`;
  });

  const getLocalTodayString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // 1. 사용자 인증
  useEffect(() => {
    if (!auth) {
      setIsLoaded(true); // Firebase 설정이 없으면 로컬 모드로 시작
      return;
    }
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("인증 오류:", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. 실시간 데이터 동기화
  useEffect(() => {
    if (!user || !db) return;
    const todayStr = getLocalTodayString();
    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'dailyPlans', todayStr);

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setTasks(data.tasks ? JSON.parse(data.tasks) : []);
        setSchedule(data.schedule ? JSON.parse(data.schedule) : {});
        setMergedSlots(data.mergedSlots ? JSON.parse(data.mergedSlots) : {});
        setScheduleLinks(data.scheduleLinks ? JSON.parse(data.scheduleLinks) : {});
        setFeedback(data.feedback ? JSON.parse(data.feedback) : { identity: '', reflection: '', improvement: '' });
      }
      setIsLoaded(true);
    }, (err) => {
      console.error("로딩 에러:", err);
      setIsLoaded(true);
    });

    return () => unsubscribe();
  }, [user]);

  // 3. JSON 내보내기 (구글 드라이브 보관용)
  const exportToJson = () => {
    const dataStr = JSON.stringify({ date: getLocalTodayString(), tasks, schedule, mergedSlots, scheduleLinks, feedback }, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `planner_${getLocalTodayString()}.json`;
    link.click();
    setSaveMsg('JSON 내보내기 완료! 📂');
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
        if (json.date) setPlannerDate(json.date);
        if (json.tasks) setTasks(json.tasks);
        if (json.schedule) setSchedule(json.schedule);
        if (json.mergedSlots) setMergedSlots(json.mergedSlots);
        if (json.scheduleLinks) setScheduleLinks(json.scheduleLinks);
        if (json.feedback) setFeedback(json.feedback);
        setSaveMsg('데이터 불러오기 완료! ✅');
        setTimeout(() => setSaveMsg(''), 3000);
      } catch (err) { alert('JSON 형식이 잘못되었습니다.'); }
    };
    reader.readAsText(file);
  };

  // 5. 클라우드 저장
  const saveToCloud = async () => {
    if (!user || !db) {
      alert('클라우드 설정이 되어있지 않습니다. JSON 내보내기를 사용하세요.');
      return;
    }
    setSaveMsg('저장 중...');
    const todayStr = getLocalTodayString();
    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'dailyPlans', todayStr);
    try {
      await setDoc(docRef, {
        tasks: JSON.stringify(tasks),
        schedule: JSON.stringify(schedule),
        mergedSlots: JSON.stringify(mergedSlots),
        scheduleLinks: JSON.stringify(scheduleLinks),
        feedback: JSON.stringify(feedback),
        updatedAt: new Date().toISOString()
      }, { merge: true });
      setSaveMsg('클라우드 저장 완료! ☁️');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (e) { setSaveMsg('저장 실패!'); }
  };

  if (!isLoaded) return <div className="min-h-screen flex items-center justify-center bg-[#FAF9F6]"><Loader2 className="animate-spin text-[#E27D60]" size={32} /></div>;

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#17535B] font-sans p-4 md:p-8">
      {/* Header */}
      <header className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row justify-between items-end border-b-2 border-[#E27D60] pb-4 gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight uppercase">Daily Planner</h1>
          <p className="text-sm font-bold mt-1 flex items-center gap-1 text-[#17535B]/70">
            <Calendar size={14} /> {plannerDate}
          </p>
          <p className="text-[10px] font-mono opacity-50 mt-1 flex items-center gap-1">
            <Database size={12} /> {db ? 'Cloud Sync Enabled' : 'Local File Mode (Check Vercel Env)'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {saveMsg && <span className="text-xs font-bold text-[#E27D60] mr-2">{saveMsg}</span>}
          <input type="file" ref={fileInputRef} onChange={importFromJson} className="hidden" accept=".json" />
          <button onClick={() => fileInputRef.current.click()} className="flex items-center gap-2 bg-white border border-[#17535B]/20 px-3 py-2 rounded-lg text-xs font-bold hover:bg-gray-50 transition-all"><Upload size={14} /> 불러오기</button>
          <button onClick={exportToJson} className="flex items-center gap-2 bg-white border border-[#17535B]/20 px-3 py-2 rounded-lg text-xs font-bold hover:bg-gray-50 transition-all"><Download size={14} /> 내보내기</button>
        </div>
      </header>

      {/* Main Layout */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Identity & Feedback */}
        <div className="lg:col-span-3 space-y-6">
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-[#17535B]/10">
            <h3 className="flex items-center gap-2 font-bold mb-4 text-[#E27D60]"><Target size={18} /> 정체성</h3>
            <textarea className="w-full h-32 p-3 text-sm bg-[#FAF9F6] rounded-xl border-none focus:ring-1 focus:ring-[#17535B] outline-none resize-none" value={feedback.identity} onChange={(e) => setFeedback({...feedback, identity: e.target.value})} placeholder="오늘 나는 어떤 사람인가요?" />
          </section>
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-[#17535B]/10">
            <h3 className="flex items-center gap-2 font-bold mb-4 text-[#E27D60]"><MessageSquare size={18} /> 데일리 피드백</h3>
            <div className="space-y-4">
              <textarea className="w-full h-52 p-3 text-sm bg-[#FAF9F6] rounded-xl border-none focus:ring-1 focus:ring-[#17535B] outline-none resize-none" placeholder="잘한 점 / 성취" value={feedback.reflection} onChange={(e) => setFeedback({...feedback, reflection: e.target.value})} />
              <textarea className="w-full h-52 p-3 text-sm bg-[#FAF9F6] rounded-xl border-none focus:ring-1 focus:ring-[#17535B] outline-none resize-none" placeholder="개선할 점 / 다짐" value={feedback.improvement} onChange={(e) => setFeedback({...feedback, improvement: e.target.value})} />
            </div>
          </section>
        </div>

        {/* Center: Tasks */}
        <div className="lg:col-span-6 space-y-6">
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-[#17535B]/10 h-full min-h-[600px]">
            <div className="flex justify-between items-center mb-6">
              <h3 className="flex items-center gap-2 font-bold text-xl"><CheckCircle2 size={22} className="text-[#E27D60]" /> 할 일 관리</h3>
              <button onClick={() => setTasks([...tasks, { id: Date.now(), text: '', status: '대기', reschedule: '', memo: '' }])} className="p-2 bg-[#17535B] text-white rounded-full hover:shadow-lg transition-all"><Plus size={18} /></button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left opacity-40 text-[10px] uppercase tracking-widest border-b border-[#17535B]/10">
                  <th className="pb-2 w-8"></th>
                  <th className="pb-2">내용</th>
                  <th className="pb-2 w-28">배정 시간</th>
                  <th className="pb-2 w-24">상태</th>
                  <th className="pb-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#17535B]/5">
                {tasks.map((task, idx) => (
                  <tr key={task.id} className="group hover:bg-[#FAF9F6]/50">
                    <td className="py-2">
                      <div className="flex flex-col items-center gap-0.5">
                        <button
                          onClick={() => { if (idx === 0) return; const next = [...tasks]; [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]; setTasks(next); }}
                          className={`transition-opacity ${idx === 0 ? 'opacity-10 cursor-default' : 'opacity-30 hover:opacity-100 cursor-pointer'}`}
                        ><ChevronUp size={12} /></button>
                        <button
                          onClick={() => { if (idx === tasks.length - 1) return; const next = [...tasks]; [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]; setTasks(next); }}
                          className={`transition-opacity ${idx === tasks.length - 1 ? 'opacity-10 cursor-default' : 'opacity-30 hover:opacity-100 cursor-pointer'}`}
                        ><ChevronDown size={12} /></button>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-1">
                        <input type="text" className="flex-1 bg-transparent border-none p-0 focus:ring-0 text-[#17535B]" value={task.text} onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? {...t, text: e.target.value} : t))} placeholder="할 일을 입력하세요..." />
                        <button
                          onClick={() => setSelectedTaskId(selectedTaskId === task.id ? null : task.id)}
                          className={`shrink-0 transition-colors ${selectedTaskId === task.id ? 'text-[#E27D60]' : task.memo ? 'text-[#17535B]/40 hover:text-[#E27D60]' : 'text-[#17535B]/15 hover:text-[#17535B]/40'}`}
                          title="상세 보기"
                        >
                          <FileText size={14} />
                        </button>
                      </div>
                    </td>
                    <td className="py-2">
                      {(() => {
                        const linkedTimes = Object.entries(scheduleLinks)
                          .filter(([, tid]) => tid === task.id)
                          .map(([t]) => t)
                          .sort();
                        if (linkedTimes.length === 0) return <span className="text-[10px] opacity-30">-</span>;
                        // 연속 시간을 범위로 묶어서 표시
                        const ranges = [];
                        let rangeStart = linkedTimes[0];
                        let prev = linkedTimes[0];
                        for (let i = 1; i <= linkedTimes.length; i++) {
                          const curr = linkedTimes[i];
                          const prevIdx = allTimes.indexOf(prev);
                          const currIdx = curr ? allTimes.indexOf(curr) : -1;
                          if (currIdx !== prevIdx + 1) {
                            ranges.push(rangeStart === prev ? rangeStart : `${rangeStart}~${prev}`);
                            rangeStart = curr;
                          }
                          prev = curr;
                        }
                        return (
                          <div className="flex flex-wrap gap-1">
                            {ranges.map(r => (
                              <span key={r} className="text-[9px] font-mono bg-[#E27D60]/10 text-[#E27D60] px-1 rounded">
                                {r}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="py-2">
                      <select className={`text-[10px] font-bold p-1 rounded border-none w-full text-white ${task.status === '완료' ? 'bg-green-500' : task.status === '진행중' ? 'bg-blue-500' : task.status === '미루기' ? 'bg-red-500' : task.status === '기한 연장' ? 'bg-orange-500' : 'bg-[#FAF9F6] !text-[#17535B]'}`} value={task.status} onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? {...t, status: e.target.value} : t))}>
                        <option className="bg-white text-[#17535B]">대기</option><option className="bg-white text-[#17535B]">진행중</option><option className="bg-white text-[#17535B]">완료</option><option className="bg-white text-[#17535B]">미루기</option><option className="bg-white text-[#17535B]">기한 연장</option>
                      </select>
                    </td>
                    <td className="py-2 text-right"><button onClick={() => { setTasks(tasks.filter(t => t.id !== task.id)); setScheduleLinks(Object.fromEntries(Object.entries(scheduleLinks).filter(([, tid]) => tid !== task.id))); }} className="text-red-300 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        {/* Right: TimeBox */}
        <div className="lg:col-span-3">
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-[#17535B]/10 max-h-[85vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h3 className="flex items-center gap-2 font-bold"><Clock size={18} className="text-[#E27D60]" /> Time Box</h3>
              <div className="flex items-center gap-1">
                {selectedSlots.size >= 2 && (() => {
                  const sorted = [...selectedSlots].sort((a, b) => allTimes.indexOf(a) - allTimes.indexOf(b));
                  const isConsecutive = sorted.every((t, i) => i === 0 || allTimes.indexOf(t) === allTimes.indexOf(sorted[i - 1]) + 1);
                  return isConsecutive ? (
                    <button
                      onClick={() => {
                        const start = sorted[0];
                        const end = sorted[sorted.length - 1];
                        setMergedSlots({ ...mergedSlots, [start]: end });
                        setSelectedSlots(new Set());
                      }}
                      className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-[#17535B] text-white hover:bg-[#17535B]/80 transition-all"
                    >
                      <Merge size={12} /> 합치기({sorted.length})
                    </button>
                  ) : (
                    <span className="text-[10px] text-red-400">연속 슬롯만 가능</span>
                  );
                })()}
                {selectedSlots.size > 0 && (
                  <button
                    onClick={() => setSelectedSlots(new Set())}
                    className="text-[10px] font-bold px-2 py-1 rounded-lg bg-[#FAF9F6] text-[#17535B] hover:bg-[#E27D60]/10 transition-all"
                  >
                    선택해제
                  </button>
                )}
                <button
                  onClick={() => { setIsMergeMode(!isMergeMode); setSelectedSlots(new Set()); }}
                  className={`text-[10px] font-bold px-2 py-1 rounded-lg transition-all ${isMergeMode ? 'bg-[#E27D60] text-white' : 'bg-[#FAF9F6] text-[#17535B] hover:bg-[#E27D60]/10'}`}
                >
                  {isMergeMode ? '취소' : '편집'}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              {(() => {
                // 숨겨야 할 슬롯 계산 (합쳐진 블록의 중간 슬롯들)
                const hiddenSlots = new Set();
                Object.entries(mergedSlots).forEach(([start, end]) => {
                  const startIdx = allTimes.indexOf(start);
                  const endIdx = allTimes.indexOf(end);
                  for (let i = startIdx + 1; i <= endIdx; i++) {
                    hiddenSlots.add(allTimes[i]);
                  }
                });

                return allTimes.map((time) => {
                  if (hiddenSlots.has(time)) return null;

                  const isMergedStart = mergedSlots[time];
                  const endTime = isMergedStart;
                  const endIdx = endTime ? allTimes.indexOf(endTime) : -1;
                  const nextSlotTime = endIdx >= 0 && endIdx + 1 < allTimes.length ? allTimes[endIdx + 1] : null;
                  const displayEnd = nextSlotTime || (endIdx >= 0 ? `${parseInt(endTime.split(':')[0]) + (endTime.split(':')[1] === '30' ? 1 : 0)}:${endTime.split(':')[1] === '30' ? '00' : '30'}` : null);
                  const slotCount = endIdx >= 0 ? endIdx - allTimes.indexOf(time) + 1 : 1;

                  const isSelected = selectedSlots.has(time);

                  const handleSlotClick = (e) => {
                    if (isMergedStart) return;
                    if (e.shiftKey) {
                      e.preventDefault();
                      const next = new Set(selectedSlots);
                      if (next.has(time)) next.delete(time); else next.add(time);
                      setSelectedSlots(next);
                    } else if (isMergeMode) {
                      const next = new Set(selectedSlots);
                      if (next.has(time)) next.delete(time); else next.add(time);
                      setSelectedSlots(next);
                    }
                  };

                  return (
                    <div
                      key={time}
                      onClick={handleSlotClick}
                      className={`flex gap-2 py-1 items-center border-l-2 pl-2 transition-all rounded-r-lg select-none ${
                        isMergedStart ? 'border-[#E27D60] bg-[#E27D60]/5' : 'border-transparent hover:border-[#E27D60]'
                      } ${isSelected ? 'bg-[#17535B]/10 border-[#17535B]' : ''} ${!isMergedStart ? 'cursor-pointer' : ''}`}
                      style={isMergedStart ? { minHeight: `${slotCount * 28}px` } : {}}
                    >
                      {isMergeMode && !isMergedStart && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          className="w-3 h-3 accent-[#17535B] cursor-pointer pointer-events-none"
                        />
                      )}
                      <span className="text-[10px] font-mono opacity-40 w-14 shrink-0">
                        {isMergedStart ? `${time}~${displayEnd}` : time}
                      </span>
                      {scheduleLinks[time] ? (() => {
                        const linkedTask = tasks.find(t => t.id === scheduleLinks[time]);
                        const statusColor = linkedTask?.status === '완료' ? 'bg-green-500' : linkedTask?.status === '진행중' ? 'bg-blue-500' : linkedTask?.status === '미루기' ? 'bg-red-500' : linkedTask?.status === '기한 연장' ? 'bg-orange-500' : 'bg-[#17535B]/20';
                        return (
                          <div className="flex-1 flex items-center gap-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`} />
                            <span className="text-xs truncate">{linkedTask?.text || '(삭제된 할 일)'}</span>
                            <button
                              onClick={() => {
                                const next = { ...scheduleLinks };
                                delete next[time];
                                setScheduleLinks(next);
                              }}
                              className="shrink-0 text-[#17535B]/30 hover:text-red-400 transition-colors"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        );
                      })() : (
                        <div className="flex-1 flex items-center gap-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            className="flex-1 text-xs bg-transparent border-none p-0 focus:ring-0 min-w-0"
                            placeholder="ㅡ"
                            value={schedule[time] || ''}
                            onChange={(e) => setSchedule({ ...schedule, [time]: e.target.value })}
                          />
                          {tasks.length > 0 && (
                            <select
                              value=""
                              onChange={(e) => {
                                if (e.target.value) {
                                  setScheduleLinks({ ...scheduleLinks, [time]: Number(e.target.value) });
                                  setSchedule({ ...schedule, [time]: '' });
                                }
                              }}
                              className="w-5 h-5 text-[10px] bg-transparent border-none p-0 opacity-30 hover:opacity-100 cursor-pointer focus:ring-0 shrink-0"
                              title="할 일 연결"
                            >
                              <option value="">+</option>
                              {tasks.map(t => (
                                <option key={t.id} value={t.id}>{t.text || '(빈 할 일)'}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}
                      {isMergedStart && (
                        <button
                          onClick={() => {
                            const next = { ...mergedSlots };
                            delete next[time];
                            setMergedSlots(next);
                          }}
                          className="text-[#E27D60] hover:text-red-500 transition-colors shrink-0"
                          title="분리하기"
                        >
                          <SplitSquareHorizontal size={12} />
                        </button>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </section>
        </div>
      </div>
      {/* Task Detail Side Panel */}
      {selectedTaskId && (() => {
        const task = tasks.find(t => t.id === selectedTaskId);
        if (!task) return null;
        return (
          <>
            <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setSelectedTaskId(null)} />
            <div className="fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col animate-slide-in">
              <div className="flex items-center justify-between p-6 border-b border-[#17535B]/10">
                <h3 className="font-bold text-lg text-[#17535B] truncate pr-4">{task.text || '(제목 없음)'}</h3>
                <button onClick={() => setSelectedTaskId(null)} className="text-[#17535B]/40 hover:text-[#17535B] transition-colors shrink-0"><X size={20} /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#17535B]/40 mb-2 block">상태</label>
                  <select
                    className={`text-xs font-bold p-2 rounded-lg border-none w-full text-white ${task.status === '완료' ? 'bg-green-500' : task.status === '진행중' ? 'bg-blue-500' : task.status === '미루기' ? 'bg-red-500' : task.status === '기한 연장' ? 'bg-orange-500' : 'bg-[#17535B]/20 !text-[#17535B]'}`}
                    value={task.status}
                    onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? {...t, status: e.target.value} : t))}
                  >
                    <option className="bg-white text-[#17535B]">대기</option>
                    <option className="bg-white text-[#17535B]">진행중</option>
                    <option className="bg-white text-[#17535B]">완료</option>
                    <option className="bg-white text-[#17535B]">미루기</option>
                    <option className="bg-white text-[#17535B]">기한 연장</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#17535B]/40 mb-2 block">배정 시간</label>
                  {(() => {
                    const linkedTimes = Object.entries(scheduleLinks)
                      .filter(([, tid]) => tid === task.id)
                      .map(([t]) => t)
                      .sort();
                    if (linkedTimes.length === 0) return <span className="text-xs text-[#17535B]/30">연결된 시간 없음</span>;
                    return (
                      <div className="flex flex-wrap gap-1">
                        {linkedTimes.map(t => (
                          <span key={t} className="text-xs font-mono bg-[#E27D60]/10 text-[#E27D60] px-2 py-0.5 rounded">{t}</span>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#17535B]/40 mb-2 block">메모</label>
                  <textarea
                    className="w-full h-64 p-3 text-sm bg-[#FAF9F6] rounded-xl border-none focus:ring-1 focus:ring-[#17535B] outline-none resize-none"
                    placeholder="상세 내용, 체크리스트, 참고사항 등을 자유롭게 기록하세요..."
                    value={task.memo || ''}
                    onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? {...t, memo: e.target.value} : t))}
                  />
                </div>
              </div>
            </div>
          </>
        );
      })()}

      <style dangerouslySetInnerHTML={{ __html: `.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #17535B20; border-radius: 10px; } @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } } .animate-slide-in { animation: slideIn 0.2s ease-out; }` }} />
    </div>
  );
};

export default App;