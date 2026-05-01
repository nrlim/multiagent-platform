import asyncio, shutil, traceback
async def test():
    try:
        exe = shutil.which('npm')
        print(f'shutil.which("npm") = {exe}')
        if not exe:
            print('NPM not found!')
            return
        proc = await asyncio.create_subprocess_exec(exe, 'install', stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        print('Started process!')
    except Exception as e:
        print(f'Exception: {repr(e)}')
        traceback.print_exc()

if __name__ == '__main__':
    asyncio.run(test())
