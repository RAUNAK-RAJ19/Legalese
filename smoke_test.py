import requests
import time
import os

BASE_URL = "http://127.0.0.1:8000/api"

def run_smoke_test():
    print("🚀 Starting End-to-End Smoke Test...")

    # 1. Check if server is up
    try:
        resp = requests.get(f"{BASE_URL}/health")
        if resp.status_code != 200:
            print("❌ Server is not responding. Make sure uvicorn is running.")
            return
    except Exception as e:
        print(f"❌ Could not connect to server at {BASE_URL}: {e}")
        return

    # 2. Create a dummy PDF content for testing
    print("📝 Creating sample document...")
    dummy_content = b"%PDF-1.4\n1 0 obj\n<< /Title (Test) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF"
    
    # 3. Upload Document
    print("📤 Uploading document...")
    files = {'file': ('smoke_test.pdf', dummy_content, 'application/pdf')}
    resp = requests.post(f"{BASE_URL}/documents/upload", files=files)
    
    if resp.status_code != 200:
        print(f"❌ Upload failed: {resp.text}")
        return
    
    doc_id = resp.json()['document']['id']
    print(f"✅ Upload successful! Document ID: {doc_id}")
    print("⏳ Waiting for Celery background processing (this may take 10-20 seconds)...")

    # 4. Poll for status
    for i in range(10):
        time.sleep(3)
        resp = requests.get(f"{BASE_URL}/documents/{doc_id}")
        doc = resp.json()
        status = doc.get('status', 'unknown')
        print(f"   [{i+1}] Current Status: {status}")
        
        if status == 'completed':
            print("\n🎉 SMOKE TEST PASSED!")
            print(f"📊 Risk Score: {doc.get('risk_score')}")
            print(f"📄 Chunks Processed: {len(doc.get('chunks', []))}")
            return
        elif status == 'failed':
            print("\n❌ Background processing FAILED. Check your Celery logs.")
            return
            
    print("\n⏰ Timeout: Processing is taking too long. Check if Celery worker is running.")

if __name__ == "__main__":
    run_smoke_test()
