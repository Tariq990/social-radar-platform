from pathlib import Path

helper = Path('.github/scripts/v156-product-fix-safe.py')
if not helper.is_file():
    raise RuntimeError('hardened v156 patch helper missing')
code = helper.read_text()
exec(compile(code, str(helper), 'exec'))
