from pathlib import Path
p=Path('src/main.js')
s=p.read_text()
start=s.index('    // Global Fetch Interceptor: Tự động đính kèm Header X-Tenant-Slug')
end=s.index('    // ',s.index('    window.fetch = patchedFetch;',start)+len('    window.fetch = patchedFetch;')) if '    window.fetch = patchedFetch;' in s[start:] else -1
print(start,end)
