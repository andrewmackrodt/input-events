import type { ChildProcessWithoutNullStreams } from 'child_process'
import { spawn } from 'child_process'
import { clearTimeout, setTimeout } from 'timers'

const timeoutMillis = 10000

let backlightState = 1
let lastEventTime = 0
let libInputProcess: ChildProcessWithoutNullStreams | null = null
let timeoutId: NodeJS.Timeout | null = null

function exitHandler() {
    if (libInputProcess !== null) {
        libInputProcess.kill()
        libInputProcess = null
    }

    if (timeoutId !== null ) {
        clearTimeout(timeoutId)
        timeoutId = null
    }

    process.exit()
}

function disableBacklightAfterInactivity(delay: number) {
    timeoutId = setTimeout(() => {
        const elapsedSinceLastEvent = Date.now() - lastEventTime

        if (elapsedSinceLastEvent >= timeoutMillis) {
            if (timeoutId !== null) {
                clearTimeout(timeoutId)
                timeoutId = null
            }
            console.log('turning off backlight')
            void toggleBacklight()
            backlightState = 0
        } else {
            disableBacklightAfterInactivity(timeoutMillis - elapsedSinceLastEvent)
        }
    }, delay)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function onEvent(buffer: Buffer) {
    lastEventTime = Date.now()

    if (backlightState === 0) {
        console.log('turning on backlight')
        void toggleBacklight()
        backlightState = 1
        disableBacklightAfterInactivity(timeoutMillis)
    }
}

interface ConsoleResult {
    stdout?: string
    stderr?: string
    exitCode: number
}


async function exec(command: string, args: string[] = []): Promise<ConsoleResult> {
    const child = spawn(command, args)
    let resolve: (value: ConsoleResult) => void
    let reject: (error: Error) => void

    const promise = new Promise<ConsoleResult>((_resolve, _reject) => {
        resolve = _resolve
        reject = _reject
    })

    const res: Partial<ConsoleResult> = {}

    child.on('error', error => {
        try {
            child.kill('SIGKILL')
        } catch (e) {
            console.error(e)
        }
        reject(error)
    })

    child.stdout.on('data', (data: Buffer) => {
        if (typeof res.stdout === 'undefined') {
            res.stdout = ''
        }
        res.stdout += data.toString().replace(/\n$/, '')
    })

    child.stderr.on('data', (data: Buffer) => {
        if (typeof res.stderr === 'undefined') {
            res.stderr = ''
        }
        res.stderr += data.toString().replace(/\n$/, '')
    })

    child.on('exit', code => {
        if (code !== 0) {
            console.error(`${command} exited with code ${code}`)
        }
        res.exitCode = code ?? 0
        resolve(res as ConsoleResult)
    })

    return promise
}


function spawnLibInputProcess() {
    libInputProcess = spawn('stdbuf', ['-oL', '-eL', 'libinput', 'debug-events'], { detached: true })

    libInputProcess.on('error', error => {
        console.error('error: ' + error)
    })

    libInputProcess.stdout.on('data', data => {
        onEvent(data)
    })

    libInputProcess.stderr.on('data', data => {
        console.error('stderr: ' + data)
    })

    libInputProcess.on('exit', code => {
        if (code !== 0) {
            console.error('libinput exited with code ' + code)
        }
    })
}

function toggleBacklight() {
    return exec('gdbus', ['call', '--session',
        '--dest', 'org.gnome.SettingsDaemon.Power',
        '--object-path', '/org/gnome/SettingsDaemon/Power',
        '--method', 'org.gnome.SettingsDaemon.Power.Keyboard.Toggle',
    ])
}

disableBacklightAfterInactivity(timeoutMillis)
spawnLibInputProcess()

for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM', 'SIGQUIT']) {
    process.on(signal, exitHandler)
}
