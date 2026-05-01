import asyncio, traceback
async def test():
    try:
        cmd_str = 'npm install'
        proc = await asyncio.create_subprocess_shell(cmd_str, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        print('Started process!')
        async for line in proc.stdout:
            print(line.decode().strip())
    except Exception as e:
        print(f'Exception: {repr(e)}')
        traceback.print_exc()

if __name__ == '__main__':
    asyncio.run(test())
