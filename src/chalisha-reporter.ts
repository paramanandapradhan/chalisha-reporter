import { Reporter, FullResult, Suite, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid'; // Import the uuid library
import { AzureBlobStorageUploader } from './uploader/azure-blob-storage-uploader';


export type ChalishaReporterOptions = {
    reportDir?: string; // Define report output path
    reportFileName?: string; // Define report file name
    resultFileName?: string; // Define result file name
    uploaders?: {
        azureBlobStorage?: {
            containerName?: string,
            connectionString?: string,
        }
    }
}

interface TestError {
    message?: string;
    stack?: string;
}

interface TestAttachment {
    name: string;
    type: string;
    path?: string;
    url?: string;
}

interface StepDetails {
    name: string;
    duration: number;
    location?: string;
    steps?: StepDetails[];
}

export class ChalishaReporter implements Reporter {
    private reportDir: string;
    private runId: string; // Store the UUID for this test run
    private passedCount: number = 0;
    private failedCount: number = 0;
    private skippedCount: number = 0;
    private timedOutCount: number = 0;
    private interruptedCount: number = 0;
    private totalTests: number = 0;
    private startTime: Date;
    private testResults: any[] = [];
    private projectRoot: string = process.cwd();
    private browserInfo: any = {};
    private reportFileName: string;
    private resultFileName: string;
    private options: ChalishaReporterOptions
    private hostAppPackageJson?: any;

    constructor(options: ChalishaReporterOptions) {
        this.options = options;
        this.reportDir = options.reportDir || 'reports/chalisha-reporter/';
        this.reportFileName = options.reportFileName || 'report.json';
        this.resultFileName = options.resultFileName || 'result.json';
        this.runId = uuidv4(); // Generate a unique UUID for this test run
        this.startTime = new Date(); // Track the start time of the test run
        this.hostAppPackageJson = this.getHostAppPackageJson();

        // Ensure that the directory exists before writing the file
        const outputDir = path.resolve(this.projectRoot, this.reportDir);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true }); // Create directory if it doesn't exist
        } else {
            // Clean the output folder
            this.cleanDirectory(outputDir);
        }
    }

    onBegin(config: any, suite: Suite) {
        this.totalTests = suite.allTests().length;
        config.projects.forEach((project: any) => {
            this.browserInfo[project.name] = {
                name: project.name || 'unknown',
                headless: project.use.headless || false,
                viewport: project.use.viewport || { width: 1280, height: 720 },
                isMobile: project.use.isMobile || false,
                hasTouch: project.use.hasTouch || false,
            };
        });
    }

    onTestEnd(test: TestCase, result: TestResult) {
        // Increment counts based on test status
        switch (result.status) {
            case 'passed':
                this.passedCount += 1;
                break;
            case 'failed':
                this.failedCount += 1;
                break;
            case 'skipped':
                this.skippedCount += 1;
                break;
            case 'timedOut':
                this.timedOutCount += 1;
                break;
            case 'interrupted':
                this.interruptedCount += 1;
                break;
        }

        // Extract and store browser information based on project name
        let browserName: string = test.parent?.parent?.title || 'unknown';
        const browser = this.browserInfo[browserName] || {};

        // Prepare test info
        const testInfo = {
            title: test.title,
            location: test.location ? `${path.relative(this.projectRoot, test.location.file)}:${test.location.line}` : '',
            tags: test.annotations.map((a) => a.type),
            retries: test.retries,
            expectedStatus: test.expectedStatus,
            fileName: test.location?.file,
            suiteTitle: test.parent?.title,
            testId: test.id,
        };

        // Update and copy all attachments to the specified output directory
        const updatedAttachments = result.attachments.map((attachment) => {
            if (attachment.path) {
                // Generate a new UUID-based filename with the original extension
                const fileExtension = path.extname(attachment.path);
                const newFileName = `${uuidv4()}${fileExtension}`;

                const outputDir = path.resolve(this.projectRoot, this.reportDir, 'data');
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true }); // Create directory if it doesn't exist
                }

                // Define the new path for the attachment in the output directory
                const newFilePath = path.join(this.reportDir, 'data', newFileName);

                // Copy the original file to the new location
                fs.copyFileSync(attachment.path, newFilePath);

                // Return a new attachment object with updated path and URL
                return {
                    ...attachment,
                    path: newFilePath, // Update path to the new location
                    url: `./${path.relative(this.projectRoot, newFilePath)}`, // Optionally include a URL field if needed
                };
            }
            return attachment;
        });

        const { status, duration, errors, retry, parallelIndex, startTime, workerIndex, error } = result;
        const steps = this.captureNestedSteps(result.steps);

        // Include the test details in the final report
        this.testResults.push({
            test: testInfo,
            steps,
            attachments: updatedAttachments, // Use the updated attachments array with new paths
            status,
            duration,
            errors,
            retry,
            parallelIndex,
            startTime,
            workerIndex,
            error,
            browser,
        });
    }

    onEnd(result: FullResult) {
        console.log('\n');
        console.log(`Finished the run with ID: ${this.runId} and status: ${result.status}`);
        console.log(`Total duration of test run: ${result.duration} ms`);
        console.log(`Test run started at: ${result.startTime.toLocaleString()}`);


        const resultContent = {
            runId: this.runId,
            startTime: this.startTime.toISOString(),
            duration: new Date().getTime() - this.startTime.getTime(), // Duration in milliseconds
            status: result.status,
            totalTests: this.totalTests,
            passedTests: this.passedCount,
            failedTests: this.failedCount,
            skippedTests: this.skippedCount,
            timedOutTests: this.timedOutCount,
            interruptedTests: this.interruptedCount,
        };

        // Prepare the final report content with all test details
        const reportContent = {
            ...resultContent,
            tests: this.testResults,
        };

        // Save the report to the specified output file
        const resultFilePath = path.resolve(this.projectRoot, this.reportDir, this.resultFileName);
        fs.writeFileSync(resultFilePath, JSON.stringify(resultContent, null, 2));

        // Save the report to the specified output file
        const reportFilePath = path.resolve(this.projectRoot, this.reportDir, this.reportFileName);
        fs.writeFileSync(reportFilePath, JSON.stringify(reportContent, null, 2));

        console.log(`chalisha-reporter report saved at: ${path.resolve(this.projectRoot, this.reportDir)}`);





    }

    async onExit(): Promise<void> {
        // Start upload to Azure
        let azureConnectionString = this.options?.uploaders?.azureBlobStorage?.connectionString || '';
        let azureContainerName = this.options?.uploaders?.azureBlobStorage?.containerName || 'reports';
        if (azureConnectionString) {
            const azureUploader = new AzureBlobStorageUploader({
                runId: this.runId,
                appName: this.hostAppPackageJson?.name || '',
                reportDir: this.reportDir,
                connectionString: azureConnectionString,
                containerName: azureContainerName
            });

            console.log('Starting upload to Azure blob storage ...')
            await azureUploader.uploadPlaywrightReport();
        }
    }

    /**
     * 
     * Method to clean the directory by removing all files and subdirectories
     */
    private cleanDirectory(directoryPath: string) {
        fs.readdirSync(directoryPath).forEach((file) => {
            const fullPath = path.join(directoryPath, file);
            if (fs.lstatSync(fullPath).isDirectory()) {
                // Recursively remove subdirectory and its contents
                fs.rmdirSync(fullPath, { recursive: true });
            } else {
                // Remove file
                fs.unlinkSync(fullPath);
            }
        });
        console.log(`Cleaned output directory: ${directoryPath}`);
    }

    /**
     * Recursively captures nested steps up to 4 levels deep.
     * @param steps The list of test steps.
     * @param level The current depth level.
     * @returns An array of captured step details.
     */
    private captureNestedSteps(steps: TestStep[], level: number = 0): StepDetails[] {
        if (!steps || steps.length === 0 || level >= 4) {
            return []; // Stop recursion if no steps or level is greater than or equal to 4
        }

        return steps.map((step: TestStep) => ({
            name: step.title,
            duration: step.duration,
            location: step.location ? `${path.relative(this.projectRoot, step.location.file)}:${step.location.line}` : '',
            steps: this.captureNestedSteps(step.steps || [], level + 1), // Recursively capture nested steps
            error: !!step.error
        }));
    }

    /**
     * Get the host application from its package.json file.
     * @returns The host application json or null if not found.
     */
    private getHostAppPackageJson(): any | null {
        try {
            // Use require.resolve to locate the main application's package.json
            const hostAppPackagePath = require.resolve(path.join(process.cwd(), 'package.json'));

            // Read and parse the main application's package.json
            const packageJson = JSON.parse(fs.readFileSync(hostAppPackagePath, 'utf8'));
            return packageJson || null;
        } catch (error: any) {
            console.error(`Error finding or reading the main application's package.json: ${error.message}`);
            return null;
        }
    }
}

export default ChalishaReporter;
