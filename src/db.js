const { Sequelize, DataTypes, Op } = require('sequelize');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bot.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false
});

// 치킨 인증 기록 테이블
const ChickenEntry = sequelize.define('ChickenEntry', {
  guildId: { type: DataTypes.STRING, allowNull: false },
  authorId: { type: DataTypes.STRING, allowNull: false },
  authorName: { type: DataTypes.STRING, allowNull: false },
  gameMode: { 
    type: DataTypes.ENUM('solo', 'duo', 'squad'), 
    allowNull: false 
  },
  proofUrl: { type: DataTypes.STRING, allowNull: false },
  teamMembers: { 
    type: DataTypes.TEXT, // JSON string으로 저장
    allowNull: true 
  },
  verified: { 
    type: DataTypes.BOOLEAN, 
    defaultValue: false 
  },
  verifiedBy: { 
    type: DataTypes.STRING, 
    allowNull: true 
  },
  verifiedAt: { 
    type: DataTypes.DATE, 
    allowNull: true 
  },
  createdAt: { 
    type: DataTypes.DATE, 
    defaultValue: DataTypes.NOW 
  }
}, { 
  tableName: 'chicken_entries',
  indexes: [
    { fields: ['guildId', 'authorId'] },
    { fields: ['guildId', 'gameMode'] },
    { fields: ['verified'] }
  ]
});

// 개인별 치킨 집계 테이블
const UserChickenStats = sequelize.define('UserChickenStats', {
  guildId: { type: DataTypes.STRING, allowNull: false },
  userId: { type: DataTypes.STRING, allowNull: false },
  userName: { type: DataTypes.STRING, allowNull: false },
  soloChickens: { type: DataTypes.INTEGER, defaultValue: 0 },
  duoChickens: { type: DataTypes.INTEGER, defaultValue: 0 },
  squadChickens: { type: DataTypes.INTEGER, defaultValue: 0 },
  totalChickens: { type: DataTypes.INTEGER, defaultValue: 0 },
  lastUpdated: { 
    type: DataTypes.DATE, 
    defaultValue: DataTypes.NOW 
  }
}, { 
  tableName: 'user_chicken_stats',
  indexes: [
    { unique: true, fields: ['guildId', 'userId'] },
    { fields: ['guildId', 'totalChickens'] }
  ]
});

// 팀별 치킨 집계 테이블 (듀오/스쿼드)
const TeamChickenStats = sequelize.define('TeamChickenStats', {
  guildId: { type: DataTypes.STRING, allowNull: false },
  teamKey: { type: DataTypes.STRING, allowNull: false }, // 정렬된 멤버 ID들
  teamMembers: { type: DataTypes.TEXT, allowNull: false }, // JSON string
  gameMode: { 
    type: DataTypes.ENUM('duo', 'squad'), 
    allowNull: false 
  },
  chickenCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  lastChickenAt: { 
    type: DataTypes.DATE, 
    allowNull: true 
  }
}, { 
  tableName: 'team_chicken_stats',
  indexes: [
    { unique: true, fields: ['guildId', 'teamKey'] },
    { fields: ['guildId', 'gameMode', 'chickenCount'] }
  ]
});

// 서버 설정 테이블
const GuildSettings = sequelize.define('GuildSettings', {
  guildId: { type: DataTypes.STRING, allowNull: false },
  chickenChannelId: { type: DataTypes.STRING, allowNull: true },
  verificationRoleId: { type: DataTypes.STRING, allowNull: true },
  autoVerify: { type: DataTypes.BOOLEAN, defaultValue: false }
}, { 
  tableName: 'guild_settings',
  indexes: [{ unique: true, fields: ['guildId'] }]
});

async function initDB() {
  await sequelize.authenticate();
  await sequelize.sync();  // 테이블이 없으면 자동 생성
}

module.exports = { 
  sequelize, 
  Op, 
  ChickenEntry, 
  UserChickenStats, 
  TeamChickenStats, 
  GuildSettings, 
  initDB 
};
