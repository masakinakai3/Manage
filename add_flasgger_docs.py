import os
import re
import glob

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Match @bp.route(...) and def ...(...)
    # with optional decorators in between.
    pattern = r"(@\w+\.route\(['\"][^'\"]+['\"][^)]*\)\n(?:@[^\n]+\n)*def \w+\([^)]*\):)\n"
    
    def replacer(match):
        header = match.group(1)
        
        # Check if docstring already exists right after
        # match.end() is the index in original string, but we can't easily check ahead in re.sub.
        # Instead, we just replace and we will clean up double docstrings later if needed.
        
        route_match = re.search(r"@(\w+)\.route\(['\"]([^'\"]+)['\"]", header)
        if not route_match:
            return header + "\n"
            
        bp_name = route_match.group(1).replace('_bp', '').capitalize()
        
        func_name_match = re.search(r"def (\w+)\(", header)
        func_name = func_name_match.group(1) if func_name_match else "endpoint"

        docstring = f'''\n    """
    {func_name.replace('_', ' ').capitalize()}
    ---
    tags:
      - {bp_name}
    responses:
      200:
        description: Success
    """\n'''
        return header + "###INJECT###" + docstring

    new_content = re.sub(pattern, replacer, content)
    
    # We now have ###INJECT###... in the string.
    # We want to remove the injected docstring if the original code already had a docstring.
    # Split by ###INJECT###
    parts = new_content.split('###INJECT###')
    final_content = parts[0]
    
    for i in range(1, len(parts)):
        part = parts[i]
        # part starts with our injected docstring, then the original rest of the code.
        # Let's find where our injected docstring ends.
        # Our docstring ends with '    """\n'
        injected_end = part.find('    """\n') + 8
        injected_doc = part[:injected_end]
        rest_of_code = part[injected_end:]
        
        # Check if rest_of_code starts with a docstring (ignoring whitespace)
        rest_stripped = rest_of_code.lstrip(' \t\r\n')
        if rest_stripped.startswith('"""') or rest_stripped.startswith("'''"):
            # Already has a docstring, don't inject
            final_content += rest_of_code
        else:
            final_content += injected_doc + rest_of_code
            
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(final_content)

if __name__ == '__main__':
    for filepath in glob.glob('backend/routes/*.py'):
        print(f"Processing {filepath}")
        process_file(filepath)
