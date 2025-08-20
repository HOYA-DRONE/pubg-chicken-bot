const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { initDB, ChickenEntry, UserChickenStats, TeamChickenStats, GuildSettings } = require('./db.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// 게임 모드별 이모지
const GAME_MODE_EMOJIS = {
  solo: '👤',
  duo: '👥',
  squad: '👨‍👧‍👧'
};

// 게임 모드별 색상
const GAME_MODE_COLORS = {
  solo: 0xFF6B6B,
  duo: 0x4ECDC4,
  squad: 0x45B7D1
};

// 슬래시 명령어 정의에 초기화 명령어 추가
const commands = [
  {
    name: '치킨',
    description: '치킨 인증을 시작합니다',
    options: [
      {
        name: '게임모드',
        description: '게임 모드를 선택하세요',
        type: 3, // STRING
        required: true,
        choices: [
          { name: '솔로', value: 'solo' },
          { name: '듀오', value: 'duo' },
          { name: '스쿼드', value: 'squad' }
        ]
      },
      {
        name: '팀원1',
        description: '팀원 1 (선택사항)',
        type: 6, // USER
        required: false
      },
      {
        name: '팀원2',
        description: '팀원 2 (선택사항)',
        type: 6, // USER
        required: false
      },
      {
        name: '팀원3',
        description: '팀원 3 (선택사항)',
        type: 6, // USER
        required: false
      }
    ]
  },
  {
    name: '집계',
    description: '치킨 통계를 조회합니다',
    options: [
      {
        name: '유저',
        description: '조회할 유저 (선택사항)',
        type: 6, // USER
        required: false
      }
    ]
  },
  {
    name: '랭킹',
    description: '치킨 랭킹을 조회합니다',
    options: [
      {
        name: '게임모드',
        description: '랭킹을 조회할 게임 모드',
        type: 3, // STRING
        required: false,
        choices: [
          { name: '전체', value: 'total' },
          { name: '솔로', value: 'solo' },
          { name: '듀오', value: 'duo' },
          { name: '스쿼드', value: 'squad' }
        ]
      }
    ]
  },
  {
    name: '팀랭킹',
    description: '팀 치킨 랭킹을 조회합니다',
    options: [
      {
        name: '게임모드',
        description: '팀 랭킹을 조회할 게임 모드',
        type: 3, // STRING
        required: true,
        choices: [
          { name: '듀오', value: 'duo' },
          { name: '스쿼드', value: 'squad' }
        ]
      }
    ]
  },
  {
    name: '초기화',
    description: '치킨 통계를 초기화합니다 (서버장만 가능)',
    options: [
      {
        name: '타입',
        description: '초기화할 데이터 타입',
        type: 3, // STRING
        required: true,
        choices: [
          { name: '전체 초기화', value: 'all' },
          { name: '개인 통계만', value: 'user' },
          { name: '팀 통계만', value: 'team' },
          { name: '인증 기록만', value: 'entry' }
        ]
      },
      {
        name: '유저',
        description: '특정 유저만 초기화 (선택사항)',
        type: 6, // USER
        required: false
      }
    ]
  }
];

// 임시 저장소 (실제로는 Redis나 데이터베이스 사용 권장)
const pendingChickens = new Map();

client.once('ready', async () => {
  console.log(`치킨 봇이 준비되었습니다! ${client.user.tag}`);
  await initDB();
  
  // 슬래시 명령어 등록
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    console.log('슬래시 명령어를 등록하는 중...');
    
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    
    console.log('슬래시 명령어가 성공적으로 등록되었습니다!');
  } catch (error) {
    console.error('슬래시 명령어 등록 실패:', error);
  }
});

// 슬래시 명령어 처리에 초기화 추가
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  const { commandName } = interaction;
  
  try {
    switch (commandName) {
      case '치킨':
        await handleChickenStartCommand(interaction);
        break;
      case '집계':
        await handleStatsCommand(interaction);
        break;
      case '랭킹':
        await handleRankingCommand(interaction);
        break;
      case '팀랭킹':
        await handleTeamRankingCommand(interaction);
        break;
      case '초기화':
        await handleResetCommand(interaction);
        break;
    }
  } catch (error) {
    console.error('명령어 처리 오류:', error);
    await interaction.reply({ 
      content: '명령어 처리 중 오류가 발생했습니다.', 
      ephemeral: true 
    });
  }
});

// 일반 메시지 처리 (하이브리드)
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  // !인증 명령어 처리
  if (message.content === '!인증') {
    await handleChickenVerifyCommand(message);
    return;
  }
});

// 치킨 인증 시작 (슬래시 명령어)
async function handleChickenStartCommand(interaction) {
  const gameMode = interaction.options.getString('게임모드');
  const teamMember1 = interaction.options.getUser('팀원1');
  const teamMember2 = interaction.options.getUser('팀원2');
  const teamMember3 = interaction.options.getUser('팀원3');
  
  // 팀원 수 검증
  const teamMembers = [teamMember1, teamMember2, teamMember3].filter(member => member);
  
  if (gameMode === 'solo' && teamMembers.length > 0) {
    return interaction.reply({ 
      content: '솔로 모드에서는 팀원을 지정할 수 없습니다.', 
      ephemeral: true 
    });
  }
  
  if (gameMode === 'duo' && teamMembers.length > 1) {
    return interaction.reply({ 
      content: '듀오 모드에서는 팀원을 최대 1명까지 지정할 수 있습니다.', 
      ephemeral: true 
    });
  }
  
  if (gameMode === 'squad' && teamMembers.length > 3) {
    return interaction.reply({ 
      content: '스쿼드 모드에서는 팀원을 최대 3명까지 지정할 수 있습니다.', 
      ephemeral: true 
    });
  }
  
  // 임시 저장
  const pendingData = {
    userId: interaction.user.id,
    gameMode: gameMode,
    teamMembers: teamMembers.map(member => member.id),
    timestamp: Date.now()
  };
  
  pendingChickens.set(interaction.user.id, pendingData);
  
  // 게임 모드 한국어 표시
  const gameModeDisplay = {
    'solo': '솔로',
    'duo': '듀오', 
    'squad': '스쿼드'
  };
  
  const embed = new EmbedBuilder()
    .setTitle(`${GAME_MODE_EMOJIS[gameMode]} 치킨 인증 준비`)
    .setColor(GAME_MODE_COLORS[gameMode])
    .setDescription(`${interaction.user}님의 ${gameModeDisplay[gameMode]} 치킨 인증을 시작합니다!`)
    .addFields(
      { name: '게임 모드', value: gameModeDisplay[gameMode], inline: true }
    )
    .setTimestamp();
  
  if (teamMembers.length > 0) {
    const teamMemberNames = teamMembers.map(member => member.username).join(', ');
    embed.addFields({ name: '팀원', value: teamMemberNames, inline: true });
  }
  
  embed.addFields({ 
    name: '다음 단계', 
    value: '이미지를 첨부하고 `!인증`을 입력하세요!', 
    inline: false 
  });
  
  await interaction.reply({ embeds: [embed] });
}

// 치킨 인증 완료 (일반 명령어)
async function handleChickenVerifyCommand(message) {
  const userId = message.author.id;
  const pendingData = pendingChickens.get(userId);
  
  if (!pendingData) {
    return message.reply('먼저 `/치킨` 명령어로 인증을 시작해주세요.');
  }
  
  // 10분 제한 확인
  if (Date.now() - pendingData.timestamp > 10 * 60 * 1000) {
    pendingChickens.delete(userId);
    return message.reply('인증 시간이 만료되었습니다. `/치킨` 명령어를 다시 실행해주세요.');
  }
  
  // 이미지 첨부 확인
  if (message.attachments.size === 0) {
    return message.reply('증명을 위해 이미지를 첨부해주세요.');
  }
  
  const attachment = message.attachments.first();
  if (!attachment.contentType || !attachment.contentType.startsWith('image/')) {
    return message.reply('첨부된 파일이 이미지가 아닙니다. 이미지 파일을 첨부해주세요.');
  }
  
  try {
    // 치킨 인증 기록 저장 (자동 승인)
    const entry = await ChickenEntry.create({
      guildId: message.guild.id,
      authorId: message.author.id,
      authorName: message.author.username,
      gameMode: pendingData.gameMode,
      proofUrl: attachment.url,
      teamMembers: JSON.stringify(pendingData.teamMembers),
      verified: true,
      verifiedBy: message.author.id,
      verifiedAt: new Date()
    });
    
    // 개인 통계 업데이트
    const [userStats] = await UserChickenStats.findOrCreate({
      where: { guildId: message.guild.id, userId: message.author.id },
      defaults: {
        userName: message.author.username,
        soloChickens: 0,
        duoChickens: 0,
        squadChickens: 0,
        totalChickens: 0
      }
    });
    
    // 해당 게임 모드 치킨 수 증가
    const fieldName = `${pendingData.gameMode}Chickens`;
    await userStats.increment(fieldName);
    await userStats.increment('totalChickens');
    
    // 팀 통계 업데이트 (듀오/스쿼드인 경우)
    if (pendingData.gameMode !== 'solo' && pendingData.teamMembers.length > 0) {
      const allMembers = [message.author.id, ...pendingData.teamMembers].sort();
      const teamKey = allMembers.join('_');
      
      const [teamStats] = await TeamChickenStats.findOrCreate({
        where: { guildId: message.guild.id, teamKey: teamKey },
        defaults: {
          teamMembers: JSON.stringify(allMembers),
          gameMode: pendingData.gameMode,
          chickenCount: 0
        }
      });
      
      await teamStats.increment('chickenCount');
      await teamStats.update({ lastChickenAt: new Date() });
    }
    
    // 게임 모드 한국어 표시
    const gameModeDisplay = {
      'solo': '솔로',
      'duo': '듀오', 
      'squad': '스쿼드'
    };
    
    // 성공 임베드 생성
    const embed = new EmbedBuilder()
      .setTitle(`${GAME_MODE_EMOJIS[pendingData.gameMode]} 치킨 인증 완료!`)
      .setColor(GAME_MODE_COLORS[pendingData.gameMode])
      .setDescription(`${message.author}님이 ${gameModeDisplay[pendingData.gameMode]} 모드에서 치킨을 달성했습니다!`)
      .addFields(
        { name: '게임 모드', value: gameModeDisplay[pendingData.gameMode], inline: true },
        { name: '증명 이미지', value: '첨부된 이미지', inline: true }
      )
      .setImage(attachment.url)
      .setTimestamp();
    
    if (pendingData.teamMembers.length > 0) {
      const teamMemberNames = pendingData.teamMembers.map(id => {
        const member = message.guild.members.cache.get(id);
        return member ? member.user.username : '알 수 없는 유저';
      }).join(', ');
      embed.addFields({ name: '팀원', value: teamMemberNames, inline: true });
    }
    
    // 임시 데이터 삭제
    pendingChickens.delete(userId);
    
    await message.reply({ embeds: [embed] });
    
  } catch (error) {
    console.error('치킨 인증 저장 오류:', error);
    message.reply('치킨 인증 처리 중 오류가 발생했습니다.');
  }
}

// 통계 조회
async function handleStatsCommand(interaction) {
  const targetUser = interaction.options.getUser('유저') || interaction.user;
  
  try {
    let [stats] = await UserChickenStats.findOrCreate({
      where: { guildId: interaction.guild.id, userId: targetUser.id },
      defaults: {
        userName: targetUser.username,
        soloChickens: 0,
        duoChickens: 0,
        squadChickens: 0,
        totalChickens: 0
      }
    });
    
    const embed = new EmbedBuilder()
      .setTitle('🍗 치킨 통계')
      .setColor(0xFFD700)
      .addFields(
        { name: '👤 솔로', value: `${stats.soloChickens}개`, inline: true },
        { name: '👥 듀오', value: `${stats.duoChickens}개`, inline: true },
        { name: '👨‍👧‍👧 스쿼드', value: `${stats.squadChickens}개`, inline: true },
        { name: '🍗 총 치킨', value: `${stats.totalChickens}개`, inline: true }
      )
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
    
  } catch (error) {
    console.error('통계 조회 오류:', error);
    await interaction.reply({ 
      content: '통계 조회 중 오류가 발생했습니다.', 
      ephemeral: true 
    });
  }
}

// 랭킹 조회
async function handleRankingCommand(interaction) {
  const gameMode = interaction.options.getString('게임모드') || 'total';
  
  try {
    let orderBy = 'totalChickens';
    let title = '🍗 전체 치킨 랭킹';
    
    if (gameMode === 'solo') {
      orderBy = 'soloChickens';
      title = '👤 솔로 치킨 랭킹';
    } else if (gameMode === 'duo') {
      orderBy = 'duoChickens';
      title = '👥 듀오 치킨 랭킹';
    } else if (gameMode === 'squad') {
      orderBy = 'squadChickens';
      title = '👨‍👧‍👧 스쿼드 치킨 랭킹';
    }
    
    const rankings = await UserChickenStats.findAll({
      where: { guildId: interaction.guild.id },
      order: [[orderBy, 'DESC']],
      limit: 10
    });
    
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(0xFFD700);
    
    if (rankings.length === 0) {
      embed.setDescription('아직 치킨 기록이 없습니다.');
    } else {
      const rankingText = rankings.map((rank, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        return `${medal} **${rank.userName}** - ${rank[orderBy]}개`;
      }).join('\n');
      
      embed.setDescription(rankingText);
    }
    
    embed.setTimestamp();
    await interaction.reply({ embeds: [embed] });
    
  } catch (error) {
    console.error('랭킹 조회 오류:', error);
    await interaction.reply({ 
      content: '랭킹 조회 중 오류가 발생했습니다.', 
      ephemeral: true 
    });
  }
}

// 팀 랭킹 조회
async function handleTeamRankingCommand(interaction) {
  const gameMode = interaction.options.getString('게임모드');
  
  try {
    const rankings = await TeamChickenStats.findAll({
      where: { 
        guildId: interaction.guild.id,
        gameMode: gameMode
      },
      order: [['chickenCount', 'DESC']],
      limit: 10
    });
    
    const gameModeDisplay = {
      'duo': '듀오',
      'squad': '스쿼드'
    };
    
    const embed = new EmbedBuilder()
      .setTitle(`${GAME_MODE_EMOJIS[gameMode]} ${gameModeDisplay[gameMode]} 팀 랭킹`)
      .setColor(GAME_MODE_COLORS[gameMode]);
    
    if (rankings.length === 0) {
      embed.setDescription('아직 팀 치킨 기록이 없습니다.');
    } else {
      const rankingText = rankings.map((rank, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const members = JSON.parse(rank.teamMembers);
        return `${medal} **${members.join(', ')}** - ${rank.chickenCount}개`;
      }).join('\n');
      
      embed.setDescription(rankingText);
    }
    
    embed.setTimestamp();
    await interaction.reply({ embeds: [embed] });
    
  } catch (error) {
    console.error('팀 랭킹 조회 오류:', error);
    await interaction.reply({ 
      content: '팀 랭킹 조회 중 오류가 발생했습니다.', 
      ephemeral: true 
    });
  }
}

// 초기화 명령어 처리
async function handleResetCommand(interaction) {
  // 서버장 권한 확인
  if (!interaction.member.permissions.has('ADMINISTRATOR')) {
    return interaction.reply({ 
      content: '초기화 명령어는 서버 관리자만 사용할 수 있습니다.', 
      ephemeral: true 
    });
  }
  
  const resetType = interaction.options.getString('타입');
  const targetUser = interaction.options.getUser('유저');
  
  try {
    let deletedCount = 0;
    let message = '';
    
    switch (resetType) {
      case 'all':
        // 전체 초기화
        if (targetUser) {
          // 특정 유저의 모든 데이터 삭제
          const userEntries = await ChickenEntry.destroy({
            where: { 
              guildId: interaction.guild.id, 
              authorId: targetUser.id 
            }
          });
          
          const userStats = await UserChickenStats.destroy({
            where: { 
              guildId: interaction.guild.id, 
              userId: targetUser.id 
            }
          });
          
          // 해당 유저가 포함된 팀 통계 업데이트
          const teamStats = await TeamChickenStats.findAll({
            where: { guildId: interaction.guild.id }
          });
          
          for (const team of teamStats) {
            const members = JSON.parse(team.teamMembers);
            if (members.includes(targetUser.id)) {
              await team.destroy();
            }
          }
          
          message = `${targetUser.username}님의 모든 치킨 데이터가 초기화되었습니다.`;
        } else {
          // 서버 전체 초기화
          const entries = await ChickenEntry.destroy({
            where: { guildId: interaction.guild.id }
          });
          
          const userStats = await UserChickenStats.destroy({
            where: { guildId: interaction.guild.id }
          });
          
          const teamStats = await TeamChickenStats.destroy({
            where: { guildId: interaction.guild.id }
          });
          
          message = '서버의 모든 치킨 데이터가 초기화되었습니다.';
        }
        break;
        
      case 'user':
        // 개인 통계만 초기화
        if (targetUser) {
          const userStats = await UserChickenStats.destroy({
            where: { 
              guildId: interaction.guild.id, 
              userId: targetUser.id 
            }
          });
          message = `${targetUser.username}님의 개인 통계가 초기화되었습니다.`;
        } else {
          const userStats = await UserChickenStats.destroy({
            where: { guildId: interaction.guild.id }
          });
          message = '모든 개인 통계가 초기화되었습니다.';
        }
        break;
        
      case 'team':
        // 팀 통계만 초기화
        const teamStats = await TeamChickenStats.destroy({
          where: { guildId: interaction.guild.id }
        });
        message = '모든 팀 통계가 초기화되었습니다.';
        break;
        
      case 'entry':
        // 인증 기록만 초기화
        if (targetUser) {
          const entries = await ChickenEntry.destroy({
            where: { 
              guildId: interaction.guild.id, 
              authorId: targetUser.id 
            }
          });
          message = `${targetUser.username}님의 인증 기록이 초기화되었습니다.`;
        } else {
          const entries = await ChickenEntry.destroy({
            where: { guildId: interaction.guild.id }
          });
          message = '모든 인증 기록이 초기화되었습니다.';
        }
        break;
    }
    
    const embed = new EmbedBuilder()
      .setTitle('🗑️ 데이터 초기화 완료')
      .setColor(0xFF6B6B)
      .setDescription(message)
      .addFields(
        { name: '초기화 타입', value: resetType, inline: true },
        { name: '실행자', value: interaction.user.username, inline: true }
      )
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
    
  } catch (error) {
    console.error('초기화 오류:', error);
    await interaction.reply({ 
      content: '초기화 중 오류가 발생했습니다.', 
      ephemeral: true 
    });
  }
}

client.login(process.env.DISCORD_TOKEN);
