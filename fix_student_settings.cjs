const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const targetStr = `                    results = [];
                    questionsLoaded = false;
                    resultsLoaded = false;
                    examsLoaded = false;
                    
                    updateStudentTeacherFilter();`;

const newStr = `                    results = [];
                    questionsLoaded = false;
                    resultsLoaded = false;
                    examsLoaded = false;
                    
                    if (!sRes.error && sRes.data) {
                        const sData = sRes.data;
                        appSettings = {
                            ...appSettings,
                            showResultsDetails: sData.show_results_details,
                            allowRankingDetails: sData.allow_ranking_details,
                            showDeleteSelectedRanking: sData.show_delete_selected_ranking,
                            immediateFeedback: sData.immediate_feedback,
                            sqCaseSensitive: sData.sq_case_sensitive,
                            sqPunctuationSensitive: sData.sq_punctuation_sensitive,
                            questionFontSize: sData.question_font_size,
                            answerFontSize: sData.answer_font_size,
                            displayMode: sData.display_mode,
                            appTitle: sData.app_title || appSettings.appTitle,
                            authorInfo: sData.author_info || appSettings.authorInfo,
                            aiPrompt: sData.ai_prompt || appSettings.aiPrompt,
                            aiAppraisePrompt: sData.ai_appraise_prompt || appSettings.aiAppraisePrompt,
                            aiGradingKey: sData.ai_grading_key || appSettings.aiGradingKey
                        };
                        if (appSettings.appTitle === "ỨNG DỤNG KIỂM TRA TRẮC NGHIỆM - PRO V1.0") {
                            appSettings.appTitle = "KIỂM TRA TRẮC NGHIỆM HHT PRO V1.0";
                        }
                    }
                    
                    const userPrefs = localStorage.getItem('userPreferences');
                    if (userPrefs) {
                        try {
                            const parsedPrefs = JSON.parse(userPrefs);
                            appSettings = { ...appSettings, ...parsedPrefs };
                        } catch (e) {
                            console.error('Error parsing user preferences:', e);
                        }
                    }
                    
                    updateStudentTeacherFilter();`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, newStr);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched student loadData successfully!");
} else {
    console.log("Target not found!");
}
