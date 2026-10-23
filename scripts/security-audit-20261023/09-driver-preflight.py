from pathlib import Path
p=Path('tests/security-release-acceptance.test.ts')
s=p.read_text()
a='      await ensureD1SchemaAndIndexes(shims[which]);'
assert a in s
s=s.replace(a,"      assert.equal((await shims[which].prepare('SELECT 1 AS driver_preflight').first()).driver_preflight,1);\n"+a)
p.write_text(s)
