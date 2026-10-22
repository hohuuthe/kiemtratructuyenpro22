const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const oldUpdateBlock = `        const updateSql = \`
          UPDATE exam_configs SET
            name = ?, time_limit = ?, count_41 = ?, count_tf4 = ?, count_sq = ?, count_tl = ?,
            points_41 = ?, points_tf4 = ?, points_sq = ?, points_tl = ?,
            selected_lessons = ?, tf4_scoring_mode = ?, tf4_points = ?, access_control = ?,
            immediate_feedback = ?, show_score = ?, show_details = ?,
            sq_case_sensitive = ?, sq_punctuation_sensitive = ?, auto_grade_essay = ?,
            counts_detail = ?, chedodethi = ?, mabaomatdethi = ?, tg_bd = ?, tg_kt = ?,
            ai_prompt = ?, is_shared_results = ?, updated_at = ?
          WHERE id = ?
        \`;
        await executeSqlQuery(updateSql, [
          name.trim(), timeLimitVal, count41Val, countTF4Val, countSQVal, countTLVal,
          points41Val, pointsTF4Val, pointsSQVal, pointsTLVal,
          safeSelectedLessons, safeTf4ScoringMode, safeTf4Points, safeAccessControl,
          safeImmediateFeedback, safeShowScore, safeShowDetails,
          safeSqCaseSensitive, safeSqPunctuationSensitive, safeAutoGradeEssay,
          safeCountsDetail, chedodethiVal, mabaomatdethiVal, tgBdVal, tgKtVal,
          aiPromptVal, safeIsShared, now, existingRecord.id
        ]);`;

const newUpdateBlock = `        const updateSql = \`
          UPDATE exam_configs SET
            name = ?, time_limit = ?, count_41 = ?, count_tf4 = ?, count_sq = ?, count_tl = ?,
            points_41 = ?, points_tf4 = ?, points_sq = ?, points_tl = ?,
            selected_lessons = ?, tf4_scoring_mode = ?, tf4_points = ?, access_control = ?,
            immediate_feedback = ?, show_score = ?, show_details = ?,
            sq_case_sensitive = ?, sq_punctuation_sensitive = ?, auto_grade_essay = ?,
            counts_detail = ?, chedodethi = ?, mabaomatdethi = ?, tg_bd = ?, tg_kt = ?,
            ai_prompt = ?, ai_grading_key = ?, is_shared_results = ?, updated_at = ?
          WHERE id = ?
        \`;
        await executeSqlQuery(updateSql, [
          name.trim(), timeLimitVal, count41Val, countTF4Val, countSQVal, countTLVal,
          points41Val, pointsTF4Val, pointsSQVal, pointsTLVal,
          safeSelectedLessons, safeTf4ScoringMode, safeTf4Points, safeAccessControl,
          safeImmediateFeedback, safeShowScore, safeShowDetails,
          safeSqCaseSensitive, safeSqPunctuationSensitive, safeAutoGradeEssay,
          safeCountsDetail, chedodethiVal, mabaomatdethiVal, tgBdVal, tgKtVal,
          aiPromptVal, aiGradingKeyVal, safeIsShared, now, existingRecord.id
        ]);`;

content = content.replace(oldUpdateBlock, newUpdateBlock);
fs.writeFileSync('server.ts', content);
console.log("Updated server.ts update query.");
