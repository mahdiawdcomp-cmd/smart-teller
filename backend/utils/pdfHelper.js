const PDFDocument = require('pdfkit');
const path = require('path');
const { ArabicShaper } = require('arabic-persian-reshaper');

// Font paths
const fontRegular = path.join(__dirname, '..', 'fonts', 'Tajawal-Regular.ttf');
const fontBold = path.join(__dirname, '..', 'fonts', 'Tajawal-Bold.ttf');

// Helper to check if a character is Arabic
function isArabicChar(char) {
  const code = char.charCodeAt(0);
  return (code >= 0x0600 && code <= 0x06FF) || (code >= 0x0750 && code <= 0x077F) || (code >= 0x08A0 && code <= 0x08FF) || (code >= 0xFB50 && code <= 0xFDFF) || (code >= 0xFE70 && code <= 0xFEFF);
}

// Reshapes and reverses Arabic text, keeping numbers and English words left-to-right
function bidiText(text) {
  if (!text) return '';
  
  // Reshape the Arabic letters first
  const reshaped = ArabicShaper.convertArabic(text);
  
  // Tokenize the string to separate RTL (Arabic) segments and LTR (Numbers/English) segments
  const words = reshaped.split(/(\s+)/);
  const processedWords = words.map(word => {
    // Check if the word contains Arabic letters
    let hasArabic = false;
    for (let i = 0; i < word.length; i++) {
      if (isArabicChar(word[i])) {
        hasArabic = true;
        break;
      }
    }
    
    if (hasArabic) {
      // Reverse Arabic word so it displays correctly RTL in PDFkit
      return word.split('').reverse().join('');
    } else {
      // Keep numbers/English left-to-right
      return word;
    }
  });

  // Reconnect and reverse the entire word array to keep RTL sentence ordering
  return processedWords.reverse().join('');
}

// Generate PDF Statement (returns a Promise resolving to a base64 string)
function generatePdfBase64(customerName, transactions, periodText, balance, openingBalance = 0, finalBalance = 0) {
  let opBal = openingBalance;
  let finBal = finalBalance;
  
  if (typeof customerName === 'object') {
    const data = customerName;
    customerName = data.customerName;
    transactions = data.transactions || [];
    periodText = data.periodText;
    balance = data.balance || 0;
    opBal = data.openingBalance || 0;
    finBal = data.finalBalance || 0;
  }

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers = [];
      
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData.toString('base64'));
      });

      // Register Arabic fonts
      doc.registerFont('Tajawal', fontRegular);
      doc.registerFont('Tajawal-Bold', fontBold);

      // Title
      doc.font('Tajawal-Bold')
         .fillColor('#0f172a')
         .fontSize(22)
         .text(bidiText('كشف حساب الصراف الذكي 🏦'), { align: 'center' });
      
      doc.moveDown(0.3);
      
      // Subtitle / Period
      doc.font('Tajawal')
         .fillColor('#475569')
         .fontSize(12)
         .text(bidiText(`تاريخ الكشف: ${periodText}`), { align: 'center' });

      doc.moveDown(1.2);

      // Customer Details Card
      doc.rect(50, 110, 495, 55).fillAndStroke('#f8fafc', '#cbd5e1');
      doc.fillColor('#0f172a');

      doc.font('Tajawal-Bold').fontSize(11);
      doc.text(bidiText(`اسم الزبون: ${customerName}`), 70, 122, { align: 'right', width: 450 });
      
      const formattedBalance = Number(balance).toLocaleString('en-US') + ' د.ع';
      doc.text(bidiText(`الرصيد الكلي الحالي للمكتب: ${formattedBalance}`), 70, 140, { align: 'right', width: 450 });

      // Table Header Configuration
      const tableTop = 185;
      
      // Table Header Row Background
      doc.rect(50, tableTop, 495, 25).fill('#334155');

      // Headers (RTL columns: الرصيد | له (مسدد) | عليه (مطلوب) | الملاحظات | التاريخ)
      doc.fillColor('#ffffff').font('Tajawal-Bold').fontSize(10);
      doc.text(bidiText('الرصيد'), 50, tableTop + 7, { width: 95, align: 'center' });
      doc.text(bidiText('له (مسدد)'), 145, tableTop + 7, { width: 85, align: 'center' });
      doc.text(bidiText('عليه (مطلوب)'), 230, tableTop + 7, { width: 85, align: 'center' });
      doc.text(bidiText('الملاحظات'), 315, tableTop + 7, { width: 120, align: 'center' });
      doc.text(bidiText('التاريخ'), 435, tableTop + 7, { width: 110, align: 'center' });

      // Draw Opening Balance Row (رصيد سابق)
      let y = tableTop + 25;
      doc.rect(50, y, 495, 22).fill('#f1f5f9');
      doc.fillColor('#475569').font('Tajawal-Bold').fontSize(10);
      
      const opBalStr = Number(opBal).toLocaleString('en-US') + ' د.ع';
      doc.text(bidiText(opBalStr), 50, y + 6, { width: 95, align: 'center' });
      doc.text(bidiText('-'), 145, y + 6, { width: 85, align: 'center' });
      doc.text(bidiText('-'), 230, y + 6, { width: 85, align: 'center' });
      doc.text(bidiText('رصيد سابق (افتتاحي)'), 315, y + 6, { width: 120, align: 'center' });
      doc.text(bidiText('-'), 435, y + 6, { width: 110, align: 'center' });
      
      y += 22;

      // Table Rows for Transactions
      doc.font('Tajawal').fontSize(9);

      (transactions || []).forEach((tx, idx) => {
        // Alternating row background
        if (idx % 2 === 0) {
          doc.rect(50, y, 495, 22).fill('#ffffff');
        } else {
          doc.rect(50, y, 495, 22).fill('#f8fafc');
        }
        
        doc.fillColor('#0f172a');

        const dateStr = new Date(tx.date).toLocaleDateString('en-US');
        const displayNotes = tx.type === 'withdrawal' && tx.commission > 0
          ? `${tx.notes || ''} (العمولة: ${Number(tx.commission).toLocaleString('en-US')} د.ع)`
          : (tx.notes || '-');
          
        const runningBalStr = Number(tx.runningBalance).toLocaleString('en-US') + ' د.ع';
        
        // Draw running balance
        doc.text(bidiText(runningBalStr), 50, y + 6, { width: 95, align: 'center' });
        
        // Draw له / عليه
        if (tx.type === 'deposit') {
          const depStr = Number(tx.amount).toLocaleString('en-US') + ' د.ع';
          doc.text(bidiText(depStr), 145, y + 6, { width: 85, align: 'center' });
          doc.text(bidiText('-'), 230, y + 6, { width: 85, align: 'center' });
        } else {
          doc.text(bidiText('-'), 145, y + 6, { width: 85, align: 'center' });
          const totalAmount = tx.amount + (tx.commission || 0);
          const withStr = Number(totalAmount).toLocaleString('en-US') + ' د.ع';
          doc.text(bidiText(withStr), 230, y + 6, { width: 85, align: 'center' });
        }
        
        // Draw notes & date
        doc.text(bidiText(displayNotes), 315, y + 6, { width: 120, align: 'center' });
        doc.text(bidiText(dateStr), 435, y + 6, { width: 110, align: 'center' });
        
        y += 22;
        
        // Page break handling
        if (y > 730) {
          doc.addPage();
          y = 50;
        }
      });

      // Draw thick border line at the bottom of the table
      doc.lineWidth(1.5).strokeColor('#475569').moveTo(50, y).lineTo(545, y).stroke();
      
      // Draw Final Summary Box
      y += 10;
      doc.rect(50, y, 495, 30).fill('#f1f5f9').stroke('#cbd5e1');
      doc.fillColor('#0f172a').font('Tajawal-Bold').fontSize(11);
      
      const finBalStr = Number(finBal).toLocaleString('en-US') + ' د.ع';
      const labelText = `الرصيد النهائي للمرحلة المحددة: ${finBalStr} (${finBal >= 0 ? 'له' : 'عليه'})`;
      doc.text(bidiText(labelText), 60, y + 9, { width: 475, align: 'right' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generatePdfBase64,
  bidiText
};
