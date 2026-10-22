const fs = require('fs');

let mainContent = fs.readFileSync('src/main.js', 'utf8');

const oldPayloadBlock = `                let payload = {
                    id: examConfig.id || null,
                    name: examConfig.name || 'Đề thi mặc định',
                    creator_id: examConfig.creatorId || (currentUser ? currentUser.id : null),
                    time_limit: parseInt(examConfig.timeLimit) || 45,
                    count_41: parseInt(examConfig.count41) || 0,
                    count_tf4: parseInt(examConfig.countTF4) || 0,
                    count_sq: parseInt(examConfig.countSQ) || 0,
                    count_tl: parseInt(examConfig.countTL) || 0,
                    points_41: parseFloat(examConfig.points41) || 1,
                    points_tf4: parseFloat(examConfig.pointsTF4) || 1,
                    points_sq: parseFloat(examConfig.pointsSQ) || 1,
                    points_tl: parseFloat(examConfig.pointsTL) || 1,
                    counts_detail: JSON.stringify({
                        count41NB: examConfig.count41NB || 0, count41TH: examConfig.count41TH || 0, count41VD: examConfig.count41VD || 0,
                        countTF4NB: examConfig.countTF4NB || 0, countTF4TH: examConfig.countTF4TH || 0, countTF4VD: examConfig.countTF4VD || 0,
                        countSQNB: examConfig.countSQNB || 0, countSQTH: examConfig.countSQTH || 0, countSQVD: examConfig.countSQVD || 0,
                        countTLNB: examConfig.countTLNB || 0, countTLTH: examConfig.countTLTH || 0, countTLVD: examConfig.countTLVD || 0
                    }),
                    selected_lessons: examConfig.selectedLessons || [],
                    access_control: examConfig.accessControl || null,
                    tf4_scoring_mode: examConfig.tf4ScoringMode ? 1 : 0,
                    tf4_points: examConfig.tf4Points || null,
                    is_shared_results: examConfig.isSharedResults ? 1 : 0,
                    immediate_feedback: examConfig.immediateFeedback ? 1 : 0,
                    show_score: examConfig.showScore !== false ? 1 : 0,
                    show_details: examConfig.showDetails !== false ? 1 : 0,
                    sq_case_sensitive: examConfig.sqCaseSensitive ? 1 : 0,
                    sq_punctuation_sensitive: examConfig.sqPunctuationSensitive ? 1 : 0,
                    auto_grade_essay: examConfig.autoGradeEssay !== false ? 1 : 0,
                    chedodethi: examConfig.chedodethi || 'Đề công khai',
                    mabaomatdethi: examConfig.mabaomatdethi || '',
                    tg_bd: examConfig.tgBd || null,
                    tg_kt: examConfig.tgKt || null,
                    ai_prompt: examConfig.aiPrompt || '',
                    ai_grading_key: examConfig.aiGradingKey || null,
                    shared_teachers: examConfig.sharedTeachers || []
                };`;

const newPayloadBlock = `                let payload = {
                    id: examConfig.id || null,
                    name: examConfig.name || 'Đề thi mặc định',
                    creator_id: examConfig.creatorId || (currentUser ? currentUser.id : null),
                    time_limit: parseInt(examConfig.timeLimit) || 45,
                    count_41: parseInt(examConfig.count41) || 0,
                    count_tf4: parseInt(examConfig.countTF4) || 0,
                    count_sq: parseInt(examConfig.countSQ) || 0,
                    count_tl: parseInt(examConfig.countTL) || 0,
                    points_41: parseFloat(examConfig.points41) || 1,
                    points_tf4: parseFloat(examConfig.pointsTF4) || 1,
                    points_sq: parseFloat(examConfig.pointsSQ) || 1,
                    points_tl: parseFloat(examConfig.pointsTL) || 1,
                    counts_detail: JSON.stringify({
                        count41NB: examConfig.count41NB || 0, count41TH: examConfig.count41TH || 0, count41VD: examConfig.count41VD || 0,
                        countTF4NB: examConfig.countTF4NB || 0, countTF4TH: examConfig.countTF4TH || 0, countTF4VD: examConfig.countTF4VD || 0,
                        countSQNB: examConfig.countSQNB || 0, countSQTH: examConfig.countSQTH || 0, countSQVD: examConfig.countSQVD || 0,
                        countTLNB: examConfig.countTLNB || 0, countTLTH: examConfig.countTLTH || 0, countTLVD: examConfig.countTLVD || 0
                    }),
                    selected_lessons: examConfig.selectedLessons || [],
                    access_control: examConfig.accessControl || null,
                    tf4_scoring_mode: examConfig.tf4ScoringMode ? 1 : 0,
                    tf4_points: examConfig.tf4Points || null,
                    is_shared_results: examConfig.isSharedResults ? 1 : 0,
                    immediate_feedback: examConfig.immediateFeedback ? 1 : 0,
                    show_score: examConfig.showScore === false || examConfig.showScore === 0 ? 0 : 1,
                    show_details: examConfig.showDetails === false || examConfig.showDetails === 0 ? 0 : 1,
                    sq_case_sensitive: examConfig.sqCaseSensitive ? 1 : 0,
                    sq_punctuation_sensitive: examConfig.sqPunctuationSensitive ? 1 : 0,
                    auto_grade_essay: examConfig.autoGradeEssay ? 1 : 0,
                    chedodethi: examConfig.chedodethi || 'Đề công khai',
                    mabaomatdethi: examConfig.mabaomatdethi || '',
                    tg_bd: examConfig.tgBd || null,
                    tg_kt: examConfig.tgKt || null,
                    ai_prompt: examConfig.aiPrompt || '',
                    ai_grading_key: examConfig.aiGradingKey || null,
                    shared_teachers: examConfig.sharedTeachers || []
                };`;

mainContent = mainContent.replace(oldPayloadBlock, newPayloadBlock);
fs.writeFileSync('src/main.js', mainContent);
console.log("Updated safe payload.");
