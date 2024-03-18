import fs from 'fs';
import Path from 'path';
import util from 'util';
import * as models from 'edge-impulse-api';
import program from 'commander';

const packageVersion = (<{ version: string }>JSON.parse(fs.readFileSync(
    Path.join(__dirname, '..', 'package.json'), 'utf-8'))).version;

program
    .description('Analyze best visual AD model ' + packageVersion)
    .version(packageVersion)
    .requiredOption('--out-directory <dir>', 'Directory with results')
    .allowUnknownOption(true)
    .parse(process.argv);

type Candidate = {
    filename: string,
    threshold: number,
    overallAccuracy: number,
    balancedAccuracy: number,
    anomalyAccuracy: number,
    noAnomalyAccuracy: number,
};

// tslint:disable-next-line: no-floating-promises
(async () => {
    const outDirectory = <string>program.outDirectory;

    let allCandidates: Candidate[] = [];

    console.log('Raw results per file:');
    console.log('');
    console.log('==========');
    console.log('');

    for (let file of await fs.promises.readdir(outDirectory)) {
        if (!file.endsWith('.json')) continue;

        const ret = <{
            result: models.ClassifyJobResponse,
            page: models.ClassifyJobResponsePage
        }>JSON.parse(await fs.promises.readFile(Path.join(outDirectory, file), 'utf-8'));

        function getAccuracyScore(threshold: number) {
            let correct = 0;
            let anomalyCorrect = 0;
            let noAnomalyCorrect = 0;
            let anomalyTotal = 0;
            let noAnomalyTotal = 0;

            for (let r of ret.page.result) {
                const expected = r.sample.label;
                const actual = r.classifications[0].result[0].anomaly >= threshold ?
                    'anomaly' :
                    'no anomaly';
                if (expected === actual) {
                    correct++;

                    if (expected === 'no anomaly') {
                        noAnomalyCorrect++;
                    }
                    if (expected === 'anomaly') {
                        anomalyCorrect++;
                    }
                }

                if (expected === 'no anomaly') {
                    noAnomalyTotal++;
                }
                if (expected === 'anomaly') {
                    anomalyTotal++;
                }
            }
            return {
                accuracy: correct / ret.page.result.length,
                balancedAccuracy: ((anomalyCorrect / anomalyTotal) + (noAnomalyCorrect / noAnomalyTotal)) / 2,
                anomalyAccuracy: anomalyCorrect / anomalyTotal,
                noAnomalyAccuracy: noAnomalyCorrect / noAnomalyTotal,
            };
        }

        let highestGeneralAccuracy = 0;
        let selectedGeneralThreshold = 0;

        for (let t = 0; t < 20; t += 0.1) {
            let score = getAccuracyScore(t);

            if (score.accuracy === 0 || score.anomalyAccuracy === 0 || score.noAnomalyAccuracy === 0) {
                continue;
            }

            if (score.accuracy > highestGeneralAccuracy) {
                highestGeneralAccuracy = score.accuracy;
                selectedGeneralThreshold = t;
            }
        }

        {
            const accScore = getAccuracyScore(selectedGeneralThreshold);
            console.log(file + ':');
            console.log('   threshold', selectedGeneralThreshold.toFixed(1) + ' (highest overall accuracy):');
            console.log('        overall:    ' + (accScore.accuracy * 100).toFixed(1) + '%');
            console.log('        balanced:   ' + (accScore.balancedAccuracy * 100).toFixed(1) + '%');
            console.log('        anomaly:    ' + (accScore.anomalyAccuracy * 100).toFixed(1) + '%');
            console.log('        no anomaly: ' + (accScore.noAnomalyAccuracy * 100).toFixed(1) + '%');

            allCandidates.push({
                filename: file,
                threshold: selectedGeneralThreshold,
                overallAccuracy: accScore.accuracy,
                balancedAccuracy: accScore.balancedAccuracy,
                anomalyAccuracy: accScore.anomalyAccuracy,
                noAnomalyAccuracy: accScore.noAnomalyAccuracy,
            });
        }

        let otherThresholdCandidates = new Set<number>();

        for (let minNonAnomalyAccuracy of [ 0.75, 0.8, 0.85, 0.9, 0.95, 0.98 ]) {
            let highestAnomalyAccuracy = 0;
            let selectedAnomalyThreshold = 0;

            for (let t = 20; t > 0; t -= 0.1) {
                let score = getAccuracyScore(t);

                if (score.accuracy === 0 || score.anomalyAccuracy === 0 || score.noAnomalyAccuracy === 0) {
                    continue;
                }

                if (score.noAnomalyAccuracy < minNonAnomalyAccuracy) continue;
                if (score.anomalyAccuracy > highestAnomalyAccuracy) {
                    highestAnomalyAccuracy = score.anomalyAccuracy;
                    selectedAnomalyThreshold = t;
                }
            }

            otherThresholdCandidates.add(selectedAnomalyThreshold);
        }

        for (const t of [...otherThresholdCandidates]) {
            if (t === selectedGeneralThreshold) continue;

            console.log('    threshold', t.toFixed(1) + ':');

            const accScore = getAccuracyScore(t);

            console.log('        overall:    ' + (accScore.accuracy * 100).toFixed(1) + '%');
            console.log('        balanced:   ' + (accScore.balancedAccuracy * 100).toFixed(1) + '%');
            console.log('        anomaly:    ' + (accScore.anomalyAccuracy * 100).toFixed(1) + '%');
            console.log('        no anomaly: ' + (accScore.noAnomalyAccuracy * 100).toFixed(1) + '%');

            allCandidates.push({
                filename: file,
                threshold: t,
                overallAccuracy: accScore.accuracy,
                balancedAccuracy: accScore.balancedAccuracy,
                anomalyAccuracy: accScore.anomalyAccuracy,
                noAnomalyAccuracy: accScore.noAnomalyAccuracy,
            });
        }
        console.log('');
    }

    console.log('===');
    console.log('');
    console.log('Here are some good models:');
    console.log('');

    let modelsFound: Candidate[] = [];

    let interestingModels: {
        title: string,
        fn: () => Candidate | undefined,
    }[] = [
        {
            title: 'Model with the least amount of false positives',
            fn: () => {
                const highestNoAnomaly = Math.max(...allCandidates.map(c => c.noAnomalyAccuracy));
                const found = allCandidates.filter(x => x.noAnomalyAccuracy === highestNoAnomaly)
                    .sort((a, b) => b.anomalyAccuracy - a.anomalyAccuracy)[0];
                return found;
            }
        },
        {
            title: 'Model with the highest balanced accuracy',
            fn: () => {
                const found = allCandidates.filter(x => x.noAnomalyAccuracy >= 0.5 && x.anomalyAccuracy >= 0.5)
                    .sort((a, b) => (b.balancedAccuracy) - (a.balancedAccuracy))[0];
                return found;
            }
        },
        {
            title: 'Model with the highest balanced accuracy w/ no anomaly >= 0.8',
            fn: () => {
                const found = allCandidates.filter(x => x.noAnomalyAccuracy >= 0.8)
                    .sort((a, b) => (b.balancedAccuracy) - (a.balancedAccuracy))[0];
                return found;
            }
        },
        {
            title: 'Model with the highest balanced accuracy w/ no anomaly >= 0.9',
            fn: () => {
                const found = allCandidates.filter(x => x.noAnomalyAccuracy >= 0.9)
                    .sort((a, b) => (b.balancedAccuracy) - (a.balancedAccuracy))[0];
                return found;
            }
        },
        {
            title: 'Model with the highest balanced accuracy w/ no anomaly >= 0.95',
            fn: () => {
                const found = allCandidates.filter(x => x.noAnomalyAccuracy >= 0.95)
                    .sort((a, b) => (b.balancedAccuracy) - (a.balancedAccuracy))[0];
                return found;
            }
        },
        {
            title: 'Model with the highest balanced accuracy w/ no anomaly >= 0.98',
            fn: () => {
                const found = allCandidates.filter(x => x.noAnomalyAccuracy >= 0.98)
                    .sort((a, b) => (b.balancedAccuracy) - (a.balancedAccuracy))[0];
                return found;
            }
        },
        {
            title: 'Model with the highest overall accuracy',
            fn: () => {
                const found = allCandidates.filter(x => x.noAnomalyAccuracy >= 0.5 && x.anomalyAccuracy >= 0.5)
                    .sort((a, b) => (b.overallAccuracy) - (a.overallAccuracy))[0];
                return found;
            }
        },
        {
            title: 'Model with the highest overall accuracy w/ no anomaly >= 0.8',
            fn: () => {
                const found = allCandidates.filter(x => x.noAnomalyAccuracy >= 0.8)
                    .sort((a, b) => (b.overallAccuracy) - (a.overallAccuracy))[0];
                return found;
            }
        },
        {
            title: 'Model with the highest overall accuracy w/ no anomaly >= 0.9',
            fn: () => {
                const found = allCandidates.filter(x => x.noAnomalyAccuracy >= 0.9)
                    .sort((a, b) => (b.overallAccuracy) - (a.overallAccuracy))[0];
                return found;
            }
        },
        {
            title: 'Model with the highest overall accuracy w/ no anomaly >= 0.95',
            fn: () => {
                const found = allCandidates.filter(x => x.noAnomalyAccuracy >= 0.95)
                    .sort((a, b) => (b.overallAccuracy) - (a.overallAccuracy))[0];
                return found;
            }
        },
        {
            title: 'Model with the highest overall accuracy w/ no anomaly >= 0.98',
            fn: () => {
                const found = allCandidates.filter(x => x.noAnomalyAccuracy >= 0.98)
                    .sort((a, b) => (b.overallAccuracy) - (a.overallAccuracy))[0];
                return found;
            }
        },
    ];

    for (const model of interestingModels) {
        const found = model.fn();
        if (!found) continue;
        if (modelsFound.indexOf(found) !== -1) continue;

        console.log(`${model.title}:`);
        console.log(`    ${found.filename} w/ threshold ${found.threshold.toFixed(1)}:`);
        console.log('        overall:    ' + (found.overallAccuracy * 100).toFixed(1) + '%');
        console.log('        balanced:   ' + (found.balancedAccuracy * 100).toFixed(1) + '%');
        console.log('        anomaly:    ' + (found.anomalyAccuracy * 100).toFixed(1) + '%');
        console.log('        no anomaly: ' + (found.noAnomalyAccuracy * 100).toFixed(1) + '%');
        console.log('');
        modelsFound.push(found);
    }
})();
