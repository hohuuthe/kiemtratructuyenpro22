const fs = require('fs');
let content = fs.readFileSync('functions/api/exams.ts', 'utf8');

const oldUpdateBlock = `        UPDATE exam_configs SET
          name = ?, time_limit = ?, count_41 = ?, count_tf4 = ?, count_sq = ?, count_tl = ?,
          points_41 = ?, points_tf4 = ?, points_sq = ?, points_tl = ?,
          selected_lessons = ?, tf4_scoring_mode = ?, tf4_points = ?, access_control = ?,
          immediate_feedback = ?, show_score = ?, show_details = ?,
          sq_case_sensitive = ?, sq_punctuation_sensitive = ?, auto_grade_essay = ?,
          counts_detail = ?, chedodethi = ?, mabaomatdethi = ?, tg_bd = ?, tg_kt = ?,
          ai_prompt = ?, is_shared_results = ?, updated_at = ?
        WHERE id = ?
      \`;

      await env.DB.prepare(updateSql).bind(
        name.trim(), timeLimitVal, count41Val, countTF4Val, countSQVal, countTLVal,
        points_41Val, points_tf4Val, points_sqVal, points_tlVal,
        safeSelectedLessons, safeTf4ScoringMode, safeTf4Points, safeAccessControl,
        safeImmediateFeedback, safeShowScore, safeShowDetails,
        safeSqCaseSensitive, safeSqPunctuationSensitive, safeAutoGradeEssay,
        safeCountsDetail, chedodethiVal, mabaomatdethiVal, tgBdVal, tgKtVal,
        aiPromptVal, safeIsShared, now, existingRecord.id
      ).run();`;

// Wait, the variables in exams.ts might be named points41Val or points_41Val.
// Let's replace the whole file using string replace.
