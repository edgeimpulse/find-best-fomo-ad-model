import fs from 'fs';
import Path from 'path';
import util from 'util';
import { EdgeImpulseApi } from 'edge-impulse-api';
import * as models from 'edge-impulse-api';
import program from 'commander';

const packageVersion = (<{ version: string }>JSON.parse(fs.readFileSync(
    Path.join(__dirname, '..', 'package.json'), 'utf-8'))).version;

program
    .description('Find best visual AD model ' + packageVersion)
    .version(packageVersion)
    .requiredOption('--api-key <apiKey>', 'The API key to an Edge Impulse project')
    .option('--image-sizes <imageSizes>', 'A comma separated list of image sizes to try. Default: "96, 160, 224, 320"', '96, 160, 224, 320')
    .option('--model-types <modelTypes>', 'A comma separated list of model types to try (e.g. "transfer_mobilenetv2_a1" or "transfer_mobilenetv2_a35"). ' +
        'Default: "transfer_mobilenetv2_a35"', 'transfer_mobilenetv2_a35')
    .option('--capacities <capacities>', 'A comma separated list that maps to "anomalyCapacity". Default: "low, medium, high"', 'low, medium, high')
    .option('--image-resize-mode <mode>', 'Either "squash", "fit-short", "fit-long" or "crop" (default: "squash")', 'squash')
    .allowUnknownOption(true)
    .parse(process.argv);

const apiKey = <string>program.apiKey;
const imageSizes = (<string>program.imageSizes).split(',').map(n => Number(n.trim()));
if (imageSizes.length === 0 || imageSizes.some(n => isNaN(n))) {
    console.log(`Invalid value for --image-sizes, should be all numeric (was: "${program.imageSizes}"`);
    process.exit(1);
}
const capacities = (<string>program.capacities).split(',').map(n => <models.AnomalyCapacity>n.trim());
for (const c of capacities) {
    if (models.AnomalyCapacityValues.indexOf(c) === -1) {
        console.log(`Invalid value for --capacities, "${c}" is not a valid capacity ` +
            `(valid: ${models.AnomalyCapacityValues.map(x => `"${x}"`).join(', ')})`);
        process.exit(1);
    }
}
const imageResizeMode = <models.ImpulseInputBlockResizeModeEnum>program.imageResizeMode;
if (models.ImpulseInputBlockResizeModeEnumValues.indexOf(imageResizeMode) === -1) {
    console.log(`Invalid value for --image-resize-mode, "${imageResizeMode}" is not a valid resize mode ` +
        `(valid: ${models.ImpulseInputBlockResizeModeEnumValues.map(x => `"${x}"`).join(', ')})`);
    process.exit(1);
}
const modelTypes = (<string>program.modelTypes).split(',').map(n => n.trim());

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
        console.log('Finding best visual AD model for project', project.owner, '/', project.name);
        console.log('    Image sizes:', imageSizes.join(', '));
        console.log('    Image resize mode:', imageResizeMode);
        console.log('    Model types:', modelTypes.join(', '));
        console.log('    Model capacities:', capacities.join(', '));
        console.log('');

        const projectInfo = await api.projects.getProjectInfo(project.id);
        const testsetLabels = projectInfo.dataSummaryPerCategory.testing.labels;
        if (testsetLabels.length !== 2 || testsetLabels.indexOf('anomaly') === -1 ||
            testsetLabels.indexOf('no anomaly') === -1)
        {
            console.log('ERR: Expecting two labels in your test set ("anomaly" and "no anomaly"), but your test set contains: ' +
                testsetLabels.map(t => `"${t}"`).join(', ') + '.');
            process.exit(1);
        }

        let impulse = await api.impulse.getImpulse(project.id);
        if (!impulse.impulse) {
            try {
                await api.impulse.createImpulse(project.id, <models.Impulse>{
                    inputBlocks: [{
                        id: 2,
                        type: "image",
                        name: "Image",
                        title: "Image data",
                        imageWidth: 224,
                        imageHeight: 224,
                        resizeMode: "squash",
                        resizeMethod: "lanczos3",
                        cropAnchor: "middle-center",
                    }],
                    dspBlocks: [{
                        id: 4,
                        type: "image",
                        name: "Image",
                        axes: ["image"],
                        title: "Image",
                        input: 2,
                        implementationVersion: 1
                    }],
                    learnBlocks: [{
                        id: 5,
                        type: "keras-visual-anomaly",
                        name: "Visual anomaly detection",
                        dsp: [4],
                        title: "Visual Anomaly Detection (GMM)",
                        primaryVersion: true,
                    }]
                });
            }
            catch (ex2) {
                let ex = <Error>ex2;
                let msg = ex.message || ex.toString();
                if (msg.indexOf('Unknown type keras-visual-anomaly') > -1) {
                    throw new Error(msg + ': This project has no access to Visual AD.');
                }
                throw ex;
            }
        }
        else {
            // verify impulse
            try {
                if (impulse.impulse.inputBlocks.length !== 1) {
                    throw new Error(`Expecting 1 DSP block, but you have ${impulse.impulse.inputBlocks.length})`);
                }
                if (impulse.impulse.dspBlocks.length !== 1) {
                    throw new Error(`Expecting 1 DSP block, but you have ${impulse.impulse.dspBlocks.length})`);
                }
                if (impulse.impulse.learnBlocks.length !== 1) {
                    throw new Error(`Expecting 1 learn block, but you have ${impulse.impulse.learnBlocks.length})`);
                }
                if (impulse.impulse.inputBlocks[0].type !== 'image') {
                    throw new Error(`inputBlocks[0].type should be "image" ` +
                        `(was ${impulse.impulse.inputBlocks[0].type})`);
                }
                if (impulse.impulse.dspBlocks[0].type !== 'image') {
                    throw new Error(`dspBlocks[0].type should be "image" (was ${impulse.impulse.dspBlocks[0].type})`);
                }
                if (impulse.impulse.learnBlocks[0].type !== 'keras-visual-anomaly') {
                    throw new Error(`learnBlocks[0].type should be "keras-visual-anomaly" (was ${impulse.impulse.learnBlocks[0].type})`);
                }
            }
            catch (ex2) {
                let ex = <Error>ex2;
                throw new Error('ERR: You have an existing impulse, expecting it to be a valid FOMO-AD impulse. ' +
                    (ex.message  || ex.toString()));
            }
        }

        for (const imageSize of imageSizes) {
            for (const capacity of capacities) {
                for (const modelType of modelTypes) {
                    const outFilePath = Path.join(process.cwd(), 'out', 'project-' + project.id, `result_${imageSize}_${modelType}_${capacity}.json`);
                    await fs.promises.mkdir(Path.dirname(outFilePath), { recursive: true });

                    if (await exists(outFilePath)) {
                        console.log('Skipping size=' + imageSize + ', modelType=' + modelType +
                            ', capacity=' + capacity + ', already exists');
                        continue;
                    }

                    console.log('Trying size=' + imageSize + ', modelType=' + modelType + ', capacity=' + capacity + '...');

                    impulse = await api.impulse.getImpulse(project.id);
                    if (impulse.impulse &&
                        impulse.impulse?.inputBlocks[0].imageWidth !== imageSize ||
                        impulse.impulse?.inputBlocks[0].imageHeight !== imageSize ||
                        impulse.impulse?.inputBlocks[0].resizeMode !== imageResizeMode)
                    {
                        impulse.impulse!.inputBlocks[0].imageWidth = imageSize;
                        impulse.impulse!.inputBlocks[0].imageHeight = imageSize;
                        impulse.impulse!.inputBlocks[0].resizeMode = imageResizeMode;
                        await api.impulse.createImpulse(project.id, impulse.impulse!);
                    }

                    // generate features
                    let dspJob = await api.jobs.generateFeaturesJob(project.id, {
                        dspId: impulse.impulse!.dspBlocks[0].id,
                        calculateFeatureImportance: false,
                        skipFeatureExplorer: false,
                    });
                    console.log('    Created DSP job with ID', dspJob.id);

                    await api.runJobUntilCompletion({
                        type: 'project',
                        projectId: project.id,
                        jobId: dspJob.id,
                    }, data => {
                        for (let line of data.split('\n')) {
                            if (!line.trim()) continue;
                            console.log('        ' + line.trim());
                        }
                    });

                    console.log('    DSP job completed');

                    // grab the config
                    let kerasConfig = await api.learn.getKeras(project.id, impulse.impulse!.learnBlocks[0].id);

                    if (!kerasConfig.transferLearningModels.find(x => x.type === modelType)) {
                        throw new Error('Invalid model type: ' + modelType + ', ' +
                            '(valid: ' + kerasConfig.transferLearningModels.map(t => `"${t.type}"`).join(', ') + ')');
                    }

                    kerasConfig.anomalyCapacity = capacity;
                    kerasConfig.visualLayers = [{
                        type: <models.KerasVisualLayerType>modelType,
                    }];
                    if (kerasConfig.minimumConfidenceRating <= 0 || kerasConfig.minimumConfidenceRating > 1) {
                        kerasConfig.minimumConfidenceRating = 0.5;
                    }

                    // and retrain with same config
                    let trainJob = await api.jobs.trainKerasJob(
                        project.id, impulse.impulse!.learnBlocks[0].id, kerasConfig);
                    console.log('    Created train job with ID', trainJob.id);

                    await api.runJobUntilCompletion({
                        type: 'project',
                        projectId: project.id,
                        jobId: trainJob.id,
                    }, data => {
                        for (let line of data.split('\n')) {
                            if (!line.trim()) continue;
                            console.log('        ' + line.trim());
                        }
                    });

                    console.log('    Train job completed');

                    const classifyJob = await api.jobs.startClassifyJob(project.id);
                    console.log('    Created classify job with ID', classifyJob.id);

                    await api.runJobUntilCompletion({
                        type: 'project',
                        projectId: project.id,
                        jobId: classifyJob.id,
                    }, data => {
                        for (let line of data.split('\n')) {
                            if (!line.trim()) continue;
                            console.log('        ' + line.trim());
                        }
                    });

                    console.log('    Classify job completed');

                    const result = await api.classify.getClassifyJobResult(project.id, {
                        featureExplorerOnly: true,
                    });

                    const page = await api.classify.getClassifyJobResultPage(project.id, {
                        offset: 0,
                        limit: 50000,
                    });
                    console.log('  Accuracy is', result.accuracy.accuracyScore?.toFixed(2) + '%');

                    await fs.promises.writeFile(
                        outFilePath,
                        JSON.stringify({ result, page }, null, 4),
                        'utf-8'
                    );
                }
            }
        }
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
