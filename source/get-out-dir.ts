import fs from 'fs';
import Path from 'path';
import util from 'util';
import { EdgeImpulseApi } from 'edge-impulse-api';
import program from 'commander';

const packageVersion = (<{ version: string }>JSON.parse(fs.readFileSync(
    Path.join(__dirname, '..', 'package.json'), 'utf-8'))).version;

program
    .description('Get output directory for search.js ' + packageVersion)
    .version(packageVersion)
    .requiredOption('--api-key <apiKey>', 'The API key to an Edge Impulse project')
    .allowUnknownOption(true)
    .parse(process.argv);

const apiKey = <string>program.apiKey;

// tslint:disable-next-line: no-floating-promises
(async () => {
    try {
        const api = new EdgeImpulseApi({ endpoint: process.env.EI_API_ENDPOINT });
        await api.authenticate({
            method: 'apiKey',
            apiKey: apiKey,
        });

        // list all projects (if you authenticate via API you just get one, the project for which you have the API key)
        let project = (await api.projects.listProjects()).projects[0];

        let outDir = Path.join(process.cwd(), 'out', 'project-' + project.id);

        // detect if we are in a transformation block
        if (process.env.EI_API_ENDPOINT) {
            // see if /home is writeable
            try {
                await fs.promises.writeFile('/home/test-get-out-dir.tmp', 'hello world', 'utf-8');
                await fs.promises.unlink('/home/test-get-out-dir.tmp');
                outDir = Path.join('/home', 'out');
            }
            catch (ex2) {
                console.log('ex2', ex2);
            }
        }

        console.log(outDir);
    }
    catch (ex) {
        console.log('Failed to make a request', ex);
        process.exit(1);
    }
})();

async function exists(p: string) {
    let aexists = false;
    try {
        await util.promisify(fs.stat)(p);
        aexists = true;
    } catch (ex) {
        /* noop */
    }
    return aexists;
}
