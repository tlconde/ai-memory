# Download LongMemEval datasets to external SSD

Destination: `/Volumes/SSD EXT/ai-memory-bench-data/longmemeval/`

Copy-paste each block into your terminal, one block at a time.

## 1. Change into the target directory

```
cd "/Volumes/SSD EXT/ai-memory-bench-data/longmemeval"
```

## 2. Download the oracle split (~15 MB)

```
curl -fLo longmemeval_oracle.json https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json
```

## 3. Download the S split (~277 MB)

```
curl -fLo longmemeval_s_cleaned.json https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json
```

## 4. Hash both files

```
shasum -a 256 longmemeval_oracle.json longmemeval_s_cleaned.json | tee sha256.txt
```

## 5. Paste the hash output back to Claude

I'll record the hashes in the harness manifest so the harness verifies integrity on every run.
