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

// tslint:disable-next-line: no-floating-promises
(async () => {
    const outDirectory = <string>program.outDirectory;

    let bestOverall = {
        file: '',
        threshold: 0,
        accuracy: 0,
    };

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
                anomalyAccuracy: anomalyCorrect / anomalyTotal,
                noAnomalyAccuracy: noAnomalyCorrect / noAnomalyTotal,
            };
        }

        let highestGeneralAccuracy = 0;
        let selectedGeneralThreshold = 0;

        for (let t = 0; t < 20; t += 0.1) {
            let score = getAccuracyScore(t);
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
            console.log('        anomaly:    ' + (accScore.anomalyAccuracy * 100).toFixed(1) + '%');
            console.log('        no anomaly: ' + (accScore.noAnomalyAccuracy * 100).toFixed(1) + '%');

            if (accScore.accuracy > bestOverall.accuracy) {
                bestOverall = {
                    file,
                    threshold: selectedGeneralThreshold,
                    accuracy: accScore.accuracy,
                };
            }
        }

        let otherThresholdCandidates = new Set<number>();

        for (let minNonAnomalyAccuracy of [ 0.75, 0.8, 0.85, 0.9, 0.95, 0.98 ]) {
            let highestAnomalyAccuracy = 0;
            let selectedAnomalyThreshold = 0;

            for (let t = 20; t > 0; t -= 0.1) {
                let score = getAccuracyScore(t);
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
            console.log('        anomaly:    ' + (accScore.anomalyAccuracy * 100).toFixed(1) + '%');
            console.log('        no anomaly: ' + (accScore.noAnomalyAccuracy * 100).toFixed(1) + '%');
        }
        console.log('');
    }

    console.log('===');
    console.log('');
    console.log('Best overall accuracy is', (bestOverall.accuracy * 100).toFixed(1) + '%',
        'based on', bestOverall.file, 'w/ threshold', bestOverall.threshold.toFixed(1));
    console.log('');
})();
