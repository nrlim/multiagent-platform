lines = open('routines.py').readlines()
for i, l in enumerate(lines, 1):
    if 'UiUx' in l or 'uiux_scout' in l or 'uiux_researcher' in l:
        if 'class' in l or 'role =' in l or '_make_agent_node' in l or '_emit_chat' in l:
            print(i, repr(l[:90]))
