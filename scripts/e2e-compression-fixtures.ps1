<#
.SYNOPSIS
Stands up a local Kafka broker holding one topic per compression codec, so
`backend/kafka/tests/compression_codecs.rs` has real compressed data to read.

.DESCRIPTION
The messages are produced by Kafka's own *Java* console producer, not by
librdkafka. That is the point: it is the same producer a user's services run,
and what it writes does not depend on which codecs this build happens to
support — so the fixtures stay honest even when the thing under test is broken.

Each topic's first batch is verified on disk with `kafka-dump-log` before the
script reports success, because `--compression-codec` silently producing
uncompressed batches would make the whole test vacuous (`--producer-property
compression.type=...` does exactly that: ConsoleProducer overrides it).

.EXAMPLE
pwsh scripts/e2e-compression-fixtures.ps1
$env:KAFKAOXIDE_E2E_BOOTSTRAP = "localhost:9092"
cargo test -p kafkaoxide-kafka --test compression_codecs -- --nocapture
#>
[CmdletBinding()]
param(
    # Kept short on purpose: Kafka's .bat launchers build a classpath by hand
    # and a deep install path overruns cmd.exe's 8191-character command line
    # ("The input line is too long"), which looks nothing like a path problem.
    [string]$KafkaHome = "C:\kt",
    [string]$KafkaVersion = "3.9.0",
    [string]$Bootstrap = "localhost:9092",
    [string]$TopicPrefix = "c-",
    [int]$Messages = 20
)

$ErrorActionPreference = "Stop"

$codecs = @("gzip", "snappy", "lz4", "zstd")
$dist = Join-Path $KafkaHome "k"
$bin = Join-Path $dist "bin\windows"

if (-not (Test-Path $dist)) {
    Write-Host "Downloading Kafka $KafkaVersion..."
    New-Item -ItemType Directory -Force -Path $KafkaHome | Out-Null
    $tgz = Join-Path $KafkaHome "kafka.tgz"
    $ProgressPreference = "SilentlyContinue"
    Invoke-WebRequest -UseBasicParsing -OutFile $tgz `
        -Uri "https://archive.apache.org/dist/kafka/$KafkaVersion/kafka_2.13-$KafkaVersion.tgz"
    & tar -xzf $tgz -C $KafkaHome
    Move-Item (Join-Path $KafkaHome "kafka_2.13-$KafkaVersion") $dist
    Remove-Item $tgz
}

$logs = Join-Path $KafkaHome "logs"
$properties = Join-Path $KafkaHome "server.properties"

$listening = (Test-NetConnection -ComputerName ($Bootstrap -split ":")[0] -Port ([int]($Bootstrap -split ":")[1]) -InformationLevel Quiet -WarningAction SilentlyContinue)
if (-not $listening) {
    Write-Host "Starting a KRaft broker on $Bootstrap..."
    @"
process.roles=broker,controller
node.id=1
controller.quorum.voters=1@localhost:9093
listeners=PLAINTEXT://$Bootstrap,CONTROLLER://localhost:9093
inter.broker.listener.name=PLAINTEXT
advertised.listeners=PLAINTEXT://$Bootstrap
controller.listener.names=CONTROLLER
listener.security.protocol.map=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
num.partitions=1
offsets.topic.replication.factor=1
transaction.state.log.replication.factor=1
transaction.state.log.min.isr=1
log.dirs=$($logs -replace '\','/')
"@ | Out-File -FilePath $properties -Encoding ascii

    New-Item -ItemType Directory -Force -Path $logs | Out-Null
    $uuid = & "$bin\kafka-storage.bat" random-uuid
    & "$bin\kafka-storage.bat" format -t $uuid -c $properties | Out-Null
    Start-Process -FilePath "$bin\kafka-server-start.bat" -ArgumentList $properties `
        -RedirectStandardOutput (Join-Path $KafkaHome "broker.out") `
        -RedirectStandardError (Join-Path $KafkaHome "broker.err") -WindowStyle Hidden

    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        if (Select-String -Path (Join-Path $KafkaHome "broker.out") -Pattern "Kafka Server started" -Quiet -ErrorAction SilentlyContinue) { break }
        Start-Sleep -Seconds 2
    }
    Write-Host "Broker started."
}

# Topics are never deleted and re-created here. Deleting a topic on Windows
# fails to unlink its still-open segment files, Kafka marks the whole log
# directory failed, and the broker shuts itself down mid-run. Fresh names are
# cheaper than that.
foreach ($codec in $codecs) {
    $topic = "$TopicPrefix$codec"
    & "$bin\kafka-topics.bat" --bootstrap-server $Bootstrap --create --topic $topic `
        --partitions 1 --replication-factor 1 --if-not-exists | Out-Null

    $payload = Join-Path $KafkaHome "payload.txt"
    1..$Messages | ForEach-Object { "msg-$_ payload payload payload payload payload payload payload payload" } |
        Out-File -FilePath $payload -Encoding ascii

    # Piped through cmd's `type`, not PowerShell's pipeline: Windows
    # PowerShell encodes native-command stdin itself and prefixes the stream
    # with a UTF-8 BOM, which arrives as part of the first message and makes
    # a perfectly good fetch look like a decompression failure.
    #
    # `--compression-codec`, not `--producer-property compression.type`:
    # ConsoleProducer sets compression.type itself from this option and
    # overwrites the producer property, so the other spelling produces
    # uncompressed batches while looking like it worked.
    & cmd /c "type ""$payload"" | ""$bin\kafka-console-producer.bat"" --bootstrap-server $Bootstrap --topic $topic --compression-codec $codec --batch-size 1048576" | Out-Null
    Write-Host "Produced $Messages $codec-compressed messages to $topic"
}

Write-Host "`nVerifying on disk that the batches really are compressed:"
$bad = @()
foreach ($codec in $codecs) {
    $segment = Get-ChildItem (Join-Path $logs "$TopicPrefix$codec-0\*.log") | Select-Object -First 1
    $line = (& "$bin\kafka-dump-log.bat" --files $segment.FullName | Select-String "compresscodec" | Select-Object -First 1).ToString()
    if ($line -match "compresscodec: (\w+)") { $found = $matches[1] } else { $found = "unknown" }
    "  {0,-22} compresscodec: {1}" -f "$TopicPrefix$codec", $found
    if ($found -ne $codec) { $bad += "$TopicPrefix$codec holds $found batches, expected $codec" }
}
if ($bad) { throw ("Fixtures are not what they claim to be:`n  " + ($bad -join "`n  ")) }

Write-Host "`nReady. Now run:"
Write-Host "  `$env:KAFKAOXIDE_E2E_BOOTSTRAP = `"$Bootstrap`""
Write-Host "  cargo test -p kafkaoxide-kafka --test compression_codecs -- --nocapture"
