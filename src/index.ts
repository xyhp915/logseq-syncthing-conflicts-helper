import '@logseq/libs';
import {createTwoFilesPatch} from 'diff';
import {settingsSchema} from "./settings";

//TODO: provide an icon (referenced in plugin.json)
const pluginName = 'syncthing-conflicts-helper';
const defaultConflictPageName = 'Syncthing Conflicts Report';

const conflictPageName = (): string => logseq.settings?.conflictPageName as string ?? defaultConflictPageName;

const count = (n: number, singular: string, plural: string = singular + 's'): string => n + ' ' + (n <= 1 ? singular : plural);

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
        // TODO: how to provide a label for the button when it is in the menu
        key: 'syncthing-conflicts',
        template: `<a class="button" data-on-click="onClick" title="${title}"> <span style="font-size: 16px;">${emoji}</span></a>`
    });
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

async function updateStatus(pageName: string) {
    const files = await conflicts();
    if (files.length === 0) {
        console.log(`${pluginName}: no conflicts found.`);
        registerButton("✅", "No Conflicts", () => {
            logseq.UI.showMsg("No sync conflicts found!", "success");
        });
    } else {
        console.log(`${pluginName}: found ${files.length} conflict(s).`);
        registerButton("🚨", `View ${count(files.length, 'Conflict')}`, async () => {
            await logseq.Editor.deletePage(pageName);
            const page = await logseq.Editor.createPage(pageName, {}, {createFirstBlock: false});
            if (page) {
                const pageContent = `The following sync conflicts were found`;
                const parentBlock = await logseq.Editor.insertBlock(pageName, pageContent);
                for (const file of files) {
                    const conflictFileName = file[0];
                    const conflictContent = await content(conflictFileName);
                    const originalFileName = conflictFileName.replace(/\.sync-conflict-.*/, "");
                    const originalContent = await content(originalFileName);
                    const diff = createTwoFilesPatch(originalFileName, conflictFileName, originalContent, conflictContent);
                    const added = diff.split('\n').filter(value => value.startsWith('+') && !value.startsWith('+++')).length;
                    const removed = diff.split('\n').filter(value => value.startsWith('-') && !value.startsWith('---')).length;
                    const fileBlock = await logseq.Editor.insertBlock(
                        parentBlock.uuid,
                        `
                        [[${originalFileName}]] - [[${conflictFileName}]] (${count(added, 'added line')}, ${count(removed, 'removed line')}) - {{{renderer syncthing-conflict-helper--mark-as-resolved, ${conflictFileName}}}}
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
                }
            } else {
                await logseq.UI.showMsg("Failed to create 'Sync Conflicts' page.", "error");
            }
        });
    }
}

async function execute() {
    console.log(`${pluginName}: checking for conflicts...`);
    await updateStatus(conflictPageName());
}

async function initialize() {
    logseq.useSettingsSchema(settingsSchema);

    logseq.App.onMacroRendererSlotted(({slot, payload}) => {
        const [macroName, ...args] = payload.arguments as string[];
        console.log(`${pluginName}: found ${macroName} with args: ${args.join(', ')}`);
        if (macroName !== 'syncthing-conflict-helper--mark-as-resolved') return;
        const [conflictFileName] = args;
        const key = `syncthing-conflict-helper--mark-as-resolved--${conflictFileName}`;
        const template =
            `<button
                class="ls-btn ls-btn-primary"
                title="Mark conflict as resolved and delete conflict file"
                data-on-click="markAsResolved"
                data-conflict-page="${conflictFileName}"
            >✅</button>`;
        logseq.provideUI({key, template: null, reset: true});
        logseq.provideUI({key, slot, template: template});
    });

    logseq.provideModel({
        async markAsResolved(e: any) {
            const pageName = conflictPageName();
            console.log(`${pluginName}: markAsResolved`, e);
            const conflictFileName = e?.dataset?.conflictPage;
            if (conflictFileName) {
                const page = await logseq.Editor.getPage(conflictFileName);
                if (page) {
                    await logseq.Editor.deletePage(page.name);
                    await logseq.UI.showMsg(`Conflict page '${conflictFileName}' marked as resolved and deleted.`, "success");
                    await updateStatus(pageName);
                } else {
                    await logseq.UI.showMsg(`Conflict page '${conflictFileName}' not found.`, "error");
                }
            }
        }
    })
}

async function main() {
    await initialize();
    await execute();
    setInterval(() => {
        execute();
    }, 10000);

    console.log(`${pluginName}: plugin loaded`);
}

logseq.ready(main).catch(console.error);
