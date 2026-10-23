from pathlib import Path
p=Path('src/main.js');s=p.read_text()
old="""                console.error('Error loading all results:', e);
                if (force && !silent) showToast('Lỗi khi tải lại dữ liệu kết quả: ' + (e.message || ''), 'error');
            }
        }

        window.refreshRankingResults"""
new="""                console.error('Error loading all results:', e);
                resultsLoaded = false;
                if (force && !silent) showToast('Lỗi khi tải lại dữ liệu kết quả: ' + (e.message || ''), 'error');
                throw e;
            }
        }

        window.refreshRankingResults"""
assert old in s;s=s.replace(old,new)
s=s.replace("const chunk = (json && Array.isArray(json.data)) ? json.data : [];\n                \n                if (chunk.length > 0) {\n                    allRawResults.push(...chunk);","if (!json || json.error || !Array.isArray(json.data)) throw new Error(json?.error || 'Phản hồi kết quả không hợp lệ');\n                const chunk = json.data;\n                \n                if (chunk.length > 0) {\n                    allRawResults.push(...chunk);")
s=s.replace("""            const teachers = accounts.filter(acc => creatorIds.map(String).includes(String(acc.id)));""","""            const teachers = accounts.filter(acc =>
                ['teacher','giáo viên','admin'].includes(String(acc.role || '').toLowerCase()) &&
                (creatorIds.includes(String(acc.id)) || creatorIds.includes(String(acc.user_id)) ||
                  (currentUser && String(acc.id) === String(currentUser.id)))
            );""")
# Previous API used limited public directory. Do not trigger repeated fetch loops when no teacher accounts exist.
s=s.replace("""                fetch('/api/accounts', { headers: token ? { 'Authorization': 'Bearer ' + token } : {} })
                    .then(r => r.json())""","""                fetch('/api/accounts', { headers: token ? { 'Authorization': 'Bearer ' + token } : {} })
                    .then(async r => { const j=await r.json();if(!r.ok)throw new Error(j.error||'Không thể tải giáo viên');return j; })""")
# Avoid unauthorized fake token on public settings.
s=s.replace("""fetch('/api/settings', { headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '') } }).then(res => res.json())""","""fetch('/api/settings').then(res => res.json())""",1)
# No remaining client name-based ownership inference for orphaned results.
s=s.replace("""                            (!r.user_id && u.username && String(u.username) === String(r.student_name))""","""                            false""")
p.write_text(s)
