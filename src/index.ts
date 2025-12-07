import '@logseq/libs';
import {createTwoFilesPatch} from 'diff';

//TODO: provide an icon (referenced in plugin.json)
const pluginName = 'syncthing-conflicts-helper';
const conflictPageName = 'Sync Conflicts';

async function conflicts() {
    return await logseq.DB.datascriptQuery(
        `
        [:find ?name ?page
            :where
            [?page :block/name ?name]
            [?page :block/file ?f]     ;; <-- only pages that live in a file
            [(clojure.string/includes? ?name "sync-conflict-")]]
        `
    );
}

function registerButton(emoji: string, title: string, onClick: () => void) {
    logseq.App.registerUIItem('toolbar', {
            key: 'syncthing-conflicts-helper-button',
            template: ` <a class="button" data-on-click="onClick" title="${title}"> <span style="font-size: 16px;">${emoji}</span>
                </a>
            `
        }
    );
    logseq.provideModel({onClick: onClick});
}

async function content(pageName: string, ignoreCollapsed = true): Promise<string> {
    const lines: string[] = [];

    function walk(block: any, indent = 0) {
        lines.push(' '.repeat(indent) + (block.content ?? ''));
        if (block.children) {
            for (const child of block.children) walk(child, indent + 1);
        }
    }

    const blocks = await logseq.Editor.getPageBlocksTree(pageName);
    for (const block of blocks) walk(block);

    const content = lines.join('\n')
        // Prefixing each line with '| ' to ensure proper code block formatting in Logseq and not having inlined ``` breaking the blocks
        .replace(/^/gm, '| ');

    if (ignoreCollapsed) {
        return content.replace(/^\|\s*collapsed:: true\n/g, '');
    }
    return content;
}

async function execute() {
    console.log(`${pluginName}: checking for conflicts...`);
    conflicts().then((files) => {
        if (files.length === 0) {
            console.log(`${pluginName}: no conflicts found.`);
            registerButton("✅", "No Conflicts", () => {
                logseq.UI.showMsg("No sync conflicts found!", "success");
            });
        } else {
            console.log(`${pluginName}: found ${files.length} conflict(s).`);
            registerButton("🚨", "View Conflicts", async () => {
                await logseq.Editor.deletePage(conflictPageName);
                const page = await logseq.Editor.createPage(conflictPageName, {}, {
                    createFirstBlock: false
                });
                if (page) {
                    const pageContent = `The following sync conflicts were found`;
                    const parentBlock = await logseq.Editor.insertBlock(conflictPageName, pageContent);
                    files.forEach((file: any[]) => {
                        const conflictFileName = file[0];
                        const originalFileName = conflictFileName.replace(/\.sync-conflict-.*/, "");
                        Promise.all([content(originalFileName), content(conflictFileName)]).then(async ([originalContent, conflictContent]) => {
                            const diff = createTwoFilesPatch(originalFileName, conflictFileName, originalContent, conflictContent);
                            const count = diff.split('\n').length;
                            const fileBlock = await logseq.Editor.insertBlock(
                                parentBlock.uuid,
                                `
                                diff [[${originalFileName}]] - [[${conflictFileName}]] (${count} lines)
                                collapsed:: true
                                `.replace(/^ */gm, ''),
                                {focus: false}
                            );
                            await logseq.Editor.insertBlock(
                                fileBlock.uuid,
                                `
                                \`\`\`diff
                                ${diff}
                                \`\`\`
                                `.replace(/^ */gm, ''),
                                {focus: false}
                            );
                        });
                    });
                } else {
                    await logseq.UI.showMsg("Failed to create 'Sync Conflicts' page.", "error");
                }
            });
        }
    });
}

async function main() {
    setInterval(() => {
        execute();
    }, 1000);

    console.log(`${pluginName}: plugin loaded`);
}

logseq.ready(main).catch(console.error);
